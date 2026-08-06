# taskChromePlugin：元素拾取快捷键自定义（组合串模型）

**日期**: 2026-08-06
**状态**: 已实施（组合串模型，含 OPT-20260806-047/048 演进）
**基于**: v1.7.2 快捷键三层链路（chrome.commands → SW → content + 页内 keydown 兜底）

> ⚠️ **模型演进说明（OPT-20260806-049）**：本文档最初描述「'cmd' / 'ctrl' 二选一」
> 模型（默认按系统、Popup 单选、仅修改页内兜底与文案）。实施中已演进为
> **组合串模型**：任意组合（如 `Alt+Shift+E`）、`chrome.commands.update` 动态改绑
> 浏览器级键位、MacCtrl 平台转换、Popup 展示「实际绑定 vs 配置」差异。
> 旧模型的 `elementPickerShortcut: 'cmd' | 'ctrl'` 值仍被读取端自动迁移
> （`cmd → Command+Shift+X`，`ctrl → Ctrl+Shift+X`），行为意图不变。下文为**现行**模型。

## 成功标准

| ID | 标准 |
|----|------|
| S1 | Popup「快捷键」支持捕获任意合法组合串（须含 Ctrl/Alt/Command，可选 Shift，一个按键），默认 mac ⌘+Shift+X / 其他 Ctrl+Shift+X |
| S2 | 页内 keydown 兜底严格匹配组合串：列出的修饰键必须按下、未列出的不得按下（与浏览器级键位规则一致） |
| S3 | 实时生效：SW 经 `chrome.commands.update` 改绑浏览器级键位（Chrome 110+；旧浏览器降级为仅页内兜底）+ 持久化 + 广播；content 双通道（消息 + storage.onChanged）即时更新 |
| S4 | Popup 静态键位展示跟随组合动态渲染；与 `chrome://extensions/shortcuts` 实际绑定存在差异时展示提示与「恢复」入口（OPT-20260806-048） |
| S5 | `npm test` 全绿 + 快捷键/弹窗 E2E 全绿（含自定义组合用例 OPT-20260806-047）+ USER_GUIDE 同步校验通过 |

## 方案决策

| 项 | 决策 |
|----|------|
| 组合串规范 | `Storage.normalizeShortcut`：`修饰键+按键` 白名单（Ctrl/Alt/Shift/Command，须含 Ctrl/Alt/Command 之一，≤2 修饰键，无重复），按键支持字母/ArrowUp/Comma/Period/Space 等；非法组合拒绝 |
| 浏览器级改绑 | `chrome.commands.update({ name: 'toggle-element-picker', shortcut: binding })`（Chrome 110+）；mac 下 `Ctrl` 修饰键经 `shortcutToPlatformBinding` 转 `MacCtrl`；改绑失败（占用冲突）错误原样回显 Popup |
| 旧浏览器降级 | < Chrome 110 无 commands.update：仅持久化 + 页内兜底生效，Popup 提示 |
| 手动改绑防护 | SW **不做启动重绑**（避免覆盖 chrome://extensions/shortcuts 手动设置）；Popup 打开时经 `getElementPickerShortcutStatus`（commands.getAll 对比）展示差异提示，可一键恢复（OPT-20260806-048） |
| 配置存储 | `elementPickerShortcut` key（组合串）；旧值 'cmd'/'ctrl' 自动迁移；未设置回退平台默认（mac Command+Shift+X / 其他 Ctrl+Shift+X） |
| 严格匹配 | 页内 keydown 兜底 `Storage.matchShortcutKeydown`：串中修饰键必须按下、未列出的不得按下，与浏览器级键位行为一致；与浏览器命令路径共享 300ms 去抖 |
| 实时生效 | Popup 保存 → SW 改绑 + 广播 `setElementPickerShortcut` + storage 持久化；content 双通道（消息 + storage.onChanged）兜底（新开标签页 / 广播失败） |
| 版本 | 1.7.2 → 1.8.0，description 追加快捷键自定义说明 |

## 架构

无新服务/接口；纯扩展侧：storage.js（组合串读写/迁移/匹配）→ SW（commands.update 改绑 + 状态查询）→ popup（捕获 UI + 差异提示）→ content.js（页内兜底监听）。不更新 ArchiMate。
