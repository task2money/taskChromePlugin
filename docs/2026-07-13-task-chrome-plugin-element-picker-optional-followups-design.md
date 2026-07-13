# taskChromePlugin：可选后续（UA Shadow / 截图生命周期·CDN / 嵌套 iframe）

**日期**: 2026-07-13 23:47  
**状态**: goal-mode 自动批准  
**版本目标**: plugin 1.6.0

## 成功标准

| ID | 标准 |
|----|------|
| S1 | 选中 video/audio/部分 input 等 UA Shadow 宿主时，快照与描述明确标注「原生控件 UA Shadow 内部不可穿透」；不伪造内部选择器 |
| S2 | 上传响应含 `expires_at`；支持 `PLUGIN_SCREENSHOT_PUBLIC_BASE_URL`（CDN）；`cleanup_plugin_screenshots` 管理命令按 TTL 清理 |
| S3 | 跨域多层嵌套 iframe：经 frame 祖先链向各父 frame 查询子 iframe 矩形并累加到顶层视口，用于截图裁剪 |
| S4 | `npm test` 与 Django 相关测例通过 |

## 方案决策

| 项 | 决策 | 理由 |
|----|------|------|
| UA Shadow | **检测 + 标注**，不尝试强制穿透 | Chromium 禁止扩展打开 UA shadow root；唯一诚实方案 |
| CDN | 设置项覆盖公网基址，默认仍 `build_absolute_uri` | 与现有本地 MEDIA 兼容，生产可指到 CDN |
| 清理 | management command + 路径日期启发式 | 无新表、可 cron；默认 dry-run |
| 嵌套 iframe | SW `getAllFrames` 祖先链 + 各父 frame `locateChildFrameRect` | 跨域无法从顶层直接查 leaf URL |

## 非目标

- 真正进入 `<video>` 控件内部 DOM
- 强制上云对象存储迁移（仍用 default_storage）
