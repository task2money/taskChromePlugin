# taskChromePlugin — 目录 Companion 规则

- **版本**：1.0.0
- **日期**：2026-07-18
- **适用范围**：`taskChromePlugin/` 下全部源码、文档与测试
- **优先级**：文件级 `*.ai.md` > 本目录 `ai.md` > 仓库全局 `.ai/`

## 强制：用户可见功能必须同步使用说明

凡在本扩展中**新增或变更用户可见能力**（浮窗、DevTools 面板、Popup、指针选择、捕获规则、表单字段语义、快捷键等），**必须在同一变更中**完成下列两项，禁止「只改代码、说明留到以后」：

| # | 交付物 | 路径 |
|---|--------|------|
| 1 | 人可读使用说明 | [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md) |
| 2 | UI 渲染 SSOT | [`lib/user-guide.js`](./lib/user-guide.js)（`SECTIONS` 与章节 `id`） |

并视影响面挂载到对应入口：

| 入口 | 挂载约定 |
|------|----------|
| 页内浮窗 | `#taskplugin-user-guide` ← `UserGuide.renderCollapsibleHtml({ surface: 'float' })` |
| DevTools 面板 | 「使用说明」Tab ← `UserGuide.renderFullGuideHtml({ surface: 'panel' })` |
| 扩展弹窗 | `#popup-user-guide` ← `UserGuide.renderCollapsibleHtml({ surface: 'popup' })` |

### 验收清单（实现 / Review 必勾）

- [ ] `docs/USER_GUIDE.md` 已增加或修订对应小节
- [ ] `lib/user-guide.js` 的 `SECTIONS` 已同步（`id` / `title` / `steps` / `surfaces`）
- [ ] 若新功能仅出现在某一入口，已正确设置 `surfaces`（`popup` / `float` / `panel`）
- [ ] `npm test` 中与 user-guide 相关的单测仍通过（章节 id 集合不意外丢失）
- [ ] README「功能」摘要若对外宣传该能力，已一句话对齐（可选但推荐）

### 明确禁止

- 禁止只在聊天或 PR 描述里写用法、不写入上述两份 SSOT
- 禁止 UI 三处入口长期展示过时说明（改 `user-guide.js` 即应三处生效）
- 禁止为「省事」删除使用说明区域；可折叠，不可移除挂载点

## 其它约束（摘要）

- 纯函数优先落 `lib/`，并配 `test/*.test.js`（与 element-picker / create-task-payload 一致）
- content script 改动注意 `manifest.json` `content_scripts` 注入顺序
- 版本号：用户可见行为变更时 bump `manifest.json` `version`
- 不新增未批准的敏感权限；网络与截图路径保持既有脱敏与直连约定

## 相关文档

- 功能总览：[`README.md`](./README.md)
- 使用说明：[`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md)
- 元素选择器设计：`docs/2026-07-13-task-chrome-plugin-element-picker-*.md`、`docs/2026-07-18-task-chrome-plugin-sibling-range-pick-design.md`
