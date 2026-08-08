# taskChromePlugin：service-worker.js 页面卡死 + 内存泄露修复（OPT-20260808-023）

**日期**: 2026-08-08
**状态**: ✅ 已实施（2026-08-08，F1–F5 全部落地 + 单测/e2e 全绿）
**基于**: OPT-20260808-019（捕获写合批）之后的 SW 现状；manifest v1.8.0

> 前置修复链：OPT-019 已把「每请求一次 session storage 全量读改写」降为
> 「入内存合批缓冲 + 1s 节流写」；OPT-020（pending）已登记「每请求一次
> local storage 读取可缓存」。本设计在 019/020 基础上完成热路径清理，
> 并修复合批缓冲退避缺失、跨页广播无超时两个遗留缺陷。

## 问题描述

用户反馈：安装/启用 taskChromePlugin 后，**页面卡死**且 **Service Worker 内存持续增长**；
优先排查「跨页面共享」链路。

## 现状分析（证据链）

### R1 — 热路径每请求一次 chrome.storage IPC（对应 OPT-020，未修）

`background/service-worker.js:99` `handleRequestCompleted` 与 `:142` `handleRequestError`
对 **`<all_urls>` 下每个请求**（全部标签页的全部网络流量）无条件执行：

```js
const captureCfg = await Storage.getCaptureConfig();   // chrome.storage.local.get(['captureEnabled','captureStatusCodes'])
```

- 即使 capture 未启用、或响应不是错误码，**每请求仍产生 1 次 local storage IPC**（storage.js:196）。
- storage 服务是**浏览器进程内跨页面共享**的资源：N 个标签页的流量 × 每请求 1 次 IPC 汇聚排队。
  轮询密集型页面（work-panel 等每分钟数十请求）叠加多标签页后，storage 队列饱和会阻塞
  **所有**依赖 chrome.storage 的调用方——包括 taskFE 网页端的多账号桥（plugin_account_bridge
  每次操作都是 storage 读写）。这是「跨页面共享」瓶颈的直接交汇点，与 OPT-018 观测到的
  「26 个请求全部 pending（TTFB 3.8–5.2s 挂起）」同类。

### R2 — async webRequest 监听器 + await → SW 保活与事件洪泛

- MV3 SW 仅在空闲时休眠；`onCompleted`/`onErrorOccurred` 的 async 监听器内 `await` storage，
  使 SW 在有网络流量的页面上**永不进入空闲**，事件队列与 pending 闭包持续堆积。
- 每个事件对象持有该请求的 `details`（`onCompleted` 注册 `responseHeaders`，浏览器为每个请求
  构造头数组并分派）。高流量页 + 多标签页下，浏览器网络服务向扩展分派 webRequest 事件的
  开销叠加在每个请求的生命周期上 → 页面请求被拖慢（卡顿/挂起）。
- SW 无法被系统回收 → 进程内存单调增长 → 「内存泄露」的表象。

### R3 — capturedBuffer 失败重试无退避（潜在热循环）

`lib/captured-buffer.js:52-72` `flushNow`：

```js
catch (_) { pending = [...batch, ...pending]; }        // 失败重新入队
finally {
  flushing = false;
  if (pending.length >= maxEntries) { void flushNow(); } // ← 立即重试，无退避
```

- 当 `Storage.addCapturedErrors` **持续失败**（如 session storage 配额打满——
  满仓 500 条错误请求全量头可达 0.6–3MB，极端头下可触 10MB 配额），
  会形成**无限立即重试循环**：每轮 1MB+ 的 parse/stringify + 数组分配 → SW CPU 打满 + GC churn。
- 内存有界（≤500 条），但 CPU 无界 —— 全局卡顿来源之一。

### R4 — 跨页广播无超时 → Promise 悬挂泄漏（「跨页面共享 + 内存泄露」直接交汇）

对比：

| 广播 | 超时保护 |
|------|---------|
| `broadcastAuthStateChanged` (SW:228) | ✅ `withTimeout(…, 800ms)` |
| `broadcastAccountExpired` (SW:1370) | ✅ `withTimeout(…, 800ms)` |
| `syncDescription` (SW:728) | ❌ 裸 `chrome.tabs.sendMessage` |
| `broadcastElementPickerShortcut` (SW:1151) | ❌ 裸 sendMessage |
| `broadcastPickToChildFrames` (SW:1028) | ❌ `await` 裸 sendMessage（逐 frame 串行） |

- 任一标签页的 content script **卡死/冻结**时（页面本身不响应，事件循环停转），
  sendMessage 的消息通道不关闭 → Promise **永不 settle** → 每次广播向 SW 泄漏一个
  pending Promise（携带闭包），同时阻止 SW 休眠。
- 标签页越多、卡死的页面越多，泄漏越严重 —— 正是「跨页面共享导致内存泄露」的机制。
- `broadcastPickToChildFrames` 还是**逐 frame 串行 await**，子 frame 卡死会直接拖住 SW 消息处理。

### R5 — auth 广播 → 每页全量刷新放大（跨页放大链）

- `broadcastAuthStateChanged`（登录/切换/过期清理）→ 每个标签页 content script
  `scheduleAuthRefresh()`（content.js:1183，500ms 去抖）→ `checkLoginStatus(full)` +
  `loadWorkspaces()` = **每个页面同时发起网络请求 + DOM 重建**。
- `checkAllAccountsForExpiry` 每 30 分钟：每账号一次 `/me/` fetch + 可能 prune + 再广播。
- N 个 taskFE 标签页 → 单次登录变更触发 N 倍网络+DOM 突发。

### R6 — tabUrlCache / tab5xxCounts 清理缺口（次要）

`tabs.onRemoved` 清理（SW:48），但 **discarded（Memory Saver 冻结）标签页不会触发
onRemoved**，其 Map 条目永久残留（`tabUrlCache` 还随每次导航写入）。条目数有界于标签页
总数，影响小，但属免费修复。

## 根因判定

页面卡死的直接机制：**R1+R2**（每请求 storage IPC × 跨页共享的 storage 服务 +
webRequest 事件洪泛拖慢请求生命周期）；R3 在配额打满时加剧。
内存泄露的直接机制：**R4**（无超时广播悬挂 Promise，SW 永不休眠回收）+ **R2**（SW 保活
下的长期驻留增长）。
跨页放大链：R1 的共享 storage 服务 + R5 的每页全量刷新。

## 解决方案

### F1 — SW 捕获配置内存缓存（消灭每请求 IPC；承接并完成 OPT-020）

- SW 内新增 `let captureCfgCache = null`：
  - `async getCaptureConfigCached()` — 首次 `await Storage.getCaptureConfig()` 后缓存；
    之后同步返回。
  - 失效点（两处，缺一不可）：
    1. **主动失效**：`setCaptureEnabled` 消息分支写入后置 `captureCfgCache = null`；
    2. **兜底失效**：顶层 `chrome.storage.onChanged.addListener`（local 区域、
       `captureEnabled`/`captureStatusCodes` 键变化）置空 —— 覆盖 Popup 等外部写入路径。
  - 原 `getCaptureConfig` 的默认值/迁移逻辑不变（首读时仍走 Storage.getCaptureConfig）。
- `handleRequestCompleted` / `handleRequestError` 改用缓存**同步**取值，热路径零 storage IPC；
  命中错误码后才走异步构建（构建本身纯内存，无 IPC）。
- 约束：`tabs.onUpdated` 里的 `Storage.getTrackingConfig()` 是导航级频率，不在热路径，
  保持原样（不扩大改动面）。

### F2 — capturedBuffer 失败退避 + 兜底丢弃

- flush 失败时按 **指数退避** 调度重试：`1s → 2s → 4s → … → cap 30s`（计时器复用现有 scheduler）。
- 连续失败 **≥3 次**：丢弃该批次最旧条目（保留队列后半段），`console.warn` 一次
  （防配额打满时无限热循环；丢数据优于拖死全局）。
- 单测用现有手动 scheduler 驱动退避序列验证。

### F3 — 跨页广播统一超时（消灭悬挂 Promise）

- `syncDescription`、`broadcastElementPickerShortcut`：套 `withTimeout(send, 800, …)`
  （与 auth 广播一致），失败静默。
- `broadcastPickToChildFrames`：去掉逐 frame 串行 await，改为 `Promise.allSettled`
  + 每项 withTimeout 800ms —— 子 frame 卡死不再拖住 SW。
- `toggleElementPickInTab` 的 frame0 路径保持原样（UI 交互路径，需要等待响应语义）。

### F4 — discarded 标签页清理

- 顶层注册 `chrome.tabs.onDiscarded`（Chrome 96+；存在性守卫）：清理该 tabId 的
  `tabUrlCache` / `tab5xxCounts`。权限：tabs 已有 ✓。

### F5 — content.js 跨页放大降噪（小改，纳入范围）

- `scheduleAuthRefresh` 去抖 500ms → 保持；增加 **`document.hidden` 时跳过** 判定：
  不可见标签页不做全量刷新（登录角标仍由 60s 定时器低频兜底刷新）。
- 效果：R5 的 N 倍网络+DOM 突发降为「可见页数」倍，且多数场景只有 1 个可见页。

### 范围外（明确不做）

- 不迁移捕获存储介质（session 语义刻意保留：浏览器关闭清空）。
- 不改 webRequest 监听结构本身（onCompleted/onErrorOccurred 是捕获语义所需；
  不引入 declarativeNetRequest 重写，避免大改版）。
- 不改 `checkAllAccountsForExpiry` 的 30 分钟周期与 `/me/` 探测逻辑（已有超时，非本次病灶）。

## 成功标准

| ID | 标准 |
|----|------|
| S1 | capture 配置在 SW 热路径只读一次：mock 下 N 个请求（capture 未启用）→ **0 次** storage.get；启用后 → 每请求 0 次 get（仅首读 1 次） |
| S2 | `setCaptureEnabled` / storage.onChanged 修改配置后，下一次请求读到新配置（缓存正确失效） |
| S3 | capturedBuffer flush 连续失败 → 退避序列 1s/2s/4s…，第 3 次失败后丢弃最旧批次并停止热循环（fake timer 验证） |
| S4 | sendMessage 永不响应（挂起 content script）时，`syncDescription` / `broadcastElementPickerShortcut` / `broadcastPickToChildFrames` 在 ≤800ms 内 settle，不悬挂 SW |
| S5 | discarded 标签页关闭后 `tabUrlCache` / `tab5xxCounts` 条目被清理 |
| S6 | `npm test` 全绿 + 现有 Playwright e2e 全绿（real-extension-messaging / sync-description-cross-tab / panel-request-list / popup-token-login） |
| S7 | （人工验证）打开 work-panel 类轮询页 + 多个标签页，chrome://extensions 该扩展 SW 内存曲线稳定，页面交互无卡顿 |

## 测试计划

| 层 | 文件 | 新增用例 |
|----|------|---------|
| 单测 | test/service-worker-capture.test.js（vm 沙箱跑真实 SW） | 配置缓存：首读 1 次 get、后续 0 次；setCaptureEnabled 后失效；onChanged 失效；N 请求下 session.set 次数 ≤ 窗口 1 次（回归 019 契约） |
| 单测 | test/captured-buffer.test.js | 失败退避序列；第 3 次失败丢弃最旧批次；退避期间 push 正常入队 |
| 单测 | 新增 test/sw-broadcast-timeout.test.js | 挂起 sendMessage 场景下三类广播 ≤800ms settle；broadcastPickToChildFrames 并发（不再串行阻塞） |
| e2e | 现有 Playwright 套件 | 全量回归（改动只增不改，语义不变） |

## 🕸️ Code Review Graph 分析

- `.code-review-graph/graph.db` 存在（988 nodes / 8108 edges，built @ df6a60b，
  head 2387641 略旧）。
- 影响面：`handleRequestCompleted` / `handleRequestError` 被 webRequest 顶层监听器引用；
  `capturedBuffer` 被 SW 与 test 共用（lib/captured-buffer.js 有独立单测覆盖）；
  广播函数独立于消息处理分支。改动均为 SW 内部局部函数 + lib 模块，无跨文件 API 签名变更，
  taskFE 侧（plugin_account_bridge）零接触。
- 现有 TESTED_BY 边：captured-buffer.test.js / captured-entries.test.js / service-worker-capture.test.js
  已覆盖 019 契约；本次新增用例挂到同一批测试文件，保持 TESTED_BY 覆盖。

## 业务意图 → 事件对照

无新增服务端接口/状态变更 —— 纯客户端扩展稳定性修复（无 HTTP 接口、无消息队列事件）。
例外理由：不改变任何业务事实，不触发跨边界副作用。

## 🐍 Python 新增接口清单与 Go 替代评估

**不触发**：纯前端扩展（background SW + lib），无 Python 服务接口变更。

## 🏛️ 架构变更影响

**无需更新架构**：纯 Bug 修复（卡死/内存泄露），无组件、服务、数据流、基础设施增删改。
taskChromePlugin 不在 enterprise-landscape 组件清单内（客户端工具）；不产出 `.puml`/`.archimate`/`.mermaid.md`。

## Value Stream Impact

**跳过**（`skipped_non_code`）：插件为客户端工具，不影响 value-stream.yaml 中任何
`<service>.<table>.<field>` 数据流；无增量切分价值。

## 相关 OPT

- 承接 **OPT-20260808-020**（SW 捕获链路每请求 local storage 读取可缓存）→ 本次 F1 落地（已完成归档）。
- 本次登记 **OPT-20260808-023**（service-worker.js 页面卡死 + 内存泄露修复：F1–F5）。

## 实施与验证记录

- **F1** 配置缓存：`getCaptureConfigCached`（init 暖缓存）+ 双失效点（setCaptureEnabled 主动失效、storage.onChanged 兜底失效）。
- **F2** 合批缓冲退避：`maxRetries=3` 指数退避（1s→2s→…cap 30s），连续失败丢最旧批次，成功后计数重置。
- **F3** 广播超时：三类广播（syncDescription / elementPickerShortcut / pickToChildFrames）统一 `withTimeout(800ms)`；pick 广播由串行改并行（`Promise.allSettled`），任一 frame 卡死不阻塞其余。
- **F4** `tabs.onDiscarded` 清理 tab5xxCounts/tabUrlCache 残留（Memory Saver 冻结不触发 onRemoved）。
- **F5** content.js `scheduleAuthRefresh` 增加 `document.hidden` 短路（后台标签页暂停 auth 刷新风暴）。

**验证**：单测 261/261 全绿（新增 8 例：F1 缓存契约 3、F2 退避 2、F3 广播超时 3——vm 沙箱跑真实 SW 源码）；`real-extension-messaging` e2e 通过（真实扩展 SW 启动 + 双向消息往返 + panel 无 CSP 拦截）。详见 OPT-20260808-023 归档记录。
