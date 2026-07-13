# taskChromePlugin：元素选择深层优化（closed Shadow / 跨域 iframe / 截图 URL）

**日期**: 2026-07-13 23:30  
**状态**: goal-mode 自动批准  
**版本目标**: plugin 1.5.0

## 成功标准

| ID | 标准 |
|----|------|
| S1 | closed Shadow DOM（非 UA）可选中；路径含 `>>>`，上下文标注 closed |
| S2 | 跨域 iframe：帧内 content script 可选中；顶层弹窗确认；截图按 iframe 偏移裁剪 |
| S3 | 勾选截图后上传至服务端媒体存储，描述写入 **https URL**（不再内嵌 data URL） |
| S4 | `npm test` 全绿；上传失败不静默回退 data URL |

## 方案决策

| 项 | 决策 |
|----|------|
| closed Shadow | `chrome.dom.openOrClosedShadowRoot` + 命中测试递归 |
| 跨域 iframe | 次要 content script `pick-frame.js`（`all_frames: true`）+ SW 按 frameId 广播 |
| 截图存储 | `POST /api/accounts/users/profile/plugin-screenshots/` → Django `default_storage`（与头像同属 accounts 用户媒体）；描述用返回 URL |
| Go 例外 | accounts 已承载用户媒体上传（avatar）；本接口同属用户媒体，不新建服务 |

## 架构

无新服务组件；accounts Application_Interface 增补上传动作（若有 ArchiMate 用户媒体视图可后续标注；本迭代不强制全量架构文件）。
