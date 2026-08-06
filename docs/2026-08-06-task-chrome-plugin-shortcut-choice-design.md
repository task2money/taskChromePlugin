# taskChromePlugin：元素拾取快捷键 ⌘/Ctrl 自由选择

**日期**: 2026-08-06
**状态**: goal-mode 自动批准
**基于**: v1.7.2 快捷键三层链路（chrome.commands → SW → content + 页内 keydown 兜底）

## 成功标准

| ID | 标准 |
|----|------|
| S1 | Popup「快捷键」提供 ⌘+Shift+X / Ctrl+Shift+X 单选，默认按操作系统（Mac → cmd，其他 → ctrl） |
| S2 | 页内 keydown 兜底严格匹配所选组合：'cmd' 仅 meta+shift+x，'ctrl' 仅 ctrl+shift+x，另一组合不触发 |
| S3 | 选择实时生效：Popup 保存 storage 并广播 `setElementPickerShortcut`；content 双通道（消息 + storage.onChanged）即时更新，新开标签页按存储值初始化 |
| S4 | Popup 静态键位展示（快捷键列表 / 提示行）跟随所选组合动态渲染 |
| S5 | `npm test` 全绿 + 快捷键/弹窗 E2E 全绿 + USER_GUIDE 同步校验通过 |

## 方案决策

| 项 | 决策 |
|----|------|
| 浏览器级键位 | chrome.commands 的 suggested_key 运行时**不可改**，保持 manifest 按 OS 预设（mac Command+Shift+X / 默认 Ctrl+Shift+X）；Popup 选择作用于页内兜底监听与说明文案，并在 UI 如实说明浏览器级键位前往 chrome://extensions/shortcuts 重绑 |
| 默认值解析 | `Storage.detectOsShortcut(nav)` 纯函数，userAgentData.platform → platform → userAgent 三级回退，mac 关键词命中返回 'cmd' 否则 'ctrl'；无 navigator（node 测试）回退 'ctrl' |
| 配置存储 | `elementPickerShortcut` key（'cmd' \| 'ctrl'），get/save 均做白名单归一化，非法值回退 OS 默认 |
| 严格匹配 | 原 `(e.metaKey \|\| e.ctrlKey)` 宽松匹配改为按模式严格匹配（互斥修饰键），保证「自由选择」语义；与浏览器命令路径共享 300ms 去抖不变 |
| 实时生效 | 沿用悬浮球开关模式：Popup 保存后 `tabs.sendMessage(setElementPickerShortcut)` 即时广播 + content 监听 storage.onChanged 兜底（新开标签页 / 广播失败） |
| 版本 | 1.7.2 → 1.8.0，description 追加快捷键可选说明 |

## 架构

无新服务/接口；纯扩展侧：storage.js（配置读写）→ popup（UI+广播）→ content.js（监听应用）。不更新 ArchiMate。
