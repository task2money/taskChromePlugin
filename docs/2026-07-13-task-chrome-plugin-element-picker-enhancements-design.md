# taskChromePlugin：元素选择三项增强

**日期**: 2026-07-13 23:22  
**状态**: goal-mode 自动批准  
**基于**: v1.3.0 指针选择

## 成功标准

| ID | 标准 |
|----|------|
| S1 | open Shadow DOM 内元素可选中；选择器含 `>>>` 边界 |
| S2 | 同源 iframe 内可选中；跨域 iframe 明确提示不可选 |
| S3 | 弹窗可选「附带元素截图」；确认后**上传媒体存储**，描述含 https URL（失败则提示，不静默回退 data URL） |
| S4 | DevTools「单请求创建」描述旁可触发同一套选元素，结果追加到 `#singleTaskDesc` |
| S5 | `npm test` 全绿 |

## 方案决策

| 项 | 决策 |
|----|------|
| Shadow | `composedPath()` + 祖先链跨 `shadowRoot.host`，路径用 `>>>` |
| iframe | 顶层 content script 穿透同源 `contentDocument.elementFromPoint`；**不** `all_frames`（避免重复浮窗） |
| 截图 | SW `captureVisibleTab` + OffscreenCanvas 裁剪缩放（≤400px JPEG）；弹窗默认不勾选 |
| DevTools | Panel → SW → content `startElementPick`；确认后 `elementPickResult` 回传 Panel |

## 架构

无新服务/接口；不更新 ArchiMate。
