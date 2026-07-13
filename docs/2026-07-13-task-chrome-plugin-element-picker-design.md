# taskChromePlugin：悬浮面板指针选择页面元素

**日期**: 2026-07-13 23:12  
**状态**: 已批准（goal-mode 自动采用）  
**作者**: claude

## 1. 目标与成功标准

在页内悬浮面板增加「指针选择元素」能力：用户点击指针 → 点选页面元素 → 填写调整期望 → 将**元素描述 + 调整期望 + 页面链接**追加到任务描述。

| # | 成功标准 | 可验证方式 |
|---|----------|------------|
| S1 | 悬浮面板可见「指针选择」入口 | UI 检查 |
| S2 | 进入选元素模式后，hover 高亮、点击选中（排除插件自身 DOM） | 手动 / 逻辑自测 |
| S3 | 选中后弹出对话框，可填写调整期望；取消不写入 | UI |
| S4 | 确认后描述追加含：页面 URL、元素标识、调整期望 | 单测 + 手动 |
| S5 | Esc / 再次点指针可取消选元素模式 | 手动 |
| S6 | `npm test` 通过（含 element-picker 纯函数） | CI / 本地 |

## 2. 方案选型（自动决策）

| 方案 | 说明 | 结论 |
|------|------|------|
| A. content script 内指针模式 + 页内弹窗 | 与现有浮窗同层，无新权限 | ✅ 采用 |
| B. 注入独立 overlay iframe | 隔离更强，复杂度高 | 否 |
| C. DevTools Elements 联动 | 依赖 DevTools 打开，浮窗场景不适用 | 否 |

**决策理由**：浮窗已在 content script，指针模式零权限增量；纯函数抽到 `lib/element-picker.js` 便于单测。

## 3. 交互流程

```
打开浮窗 → 点击「指针选择」
  → 进入 pick 模式（十字光标、hover outline）
  → 点击页面元素（忽略 #taskplugin-float-root 内节点）
  → 退出 pick → 弹出「调整期望」对话框
  → 确认 → append 到 #taskplugin-desc
  → 取消 / Esc → 不写入
```

## 4. 描述追加格式

```markdown
---
**页面元素调整**
- **页面链接**: <href>
- **页面标题**: <title>
- **元素**: `<tag#id.class>`
- **选择器**: `<css-path>`
- **可见文本**: "<truncated>"
- **调整期望**: <user text>
```

多次选择则多次追加块。

## 5. 改动清单

| 文件 | 变更 |
|------|------|
| `lib/element-picker.js` | 🆕 快照描述 / CSS path / 描述拼接纯函数 |
| `test/element-picker.test.js` | 🆕 单测 |
| `content/content.js` | 指针按钮、pick 模式、弹窗、写描述 |
| `content/content.css` | 高亮、弹窗、按钮样式 |
| `manifest.json` | content_scripts 增加 `lib/element-picker.js`；version bump |
| 意图 / 测试意图 / README | 需求留痕 |

## 6. 架构变更影响

- **判定**: 不更新 `docs/architecture/`  
- **理由**: 无新增服务/接口/数据流；仅扩展既有 Chrome 扩展 content script UI（属「配置/UI 微调」类，不触及 Application Component 拓扑）

## 7. 领域概念清单（轻量）

| 概念 | 说明 |
|------|------|
| ElementSnapshot | 元素只读快照（tag/id/class/path/text） |
| ElementAdjustment | 快照 + 调整期望 + 页面 URL |
| PickMode | 指针选元素会话状态 |

## 8. 价值流影响（预览）

- 影响流：Chrome 插件「页内浮窗快速创建任务」
- 新增步骤：指针选元素 → 填写调整期望 → 写入描述
- 测试：`taskChromePlugin/test/element-picker.test.js`

## 9. 权限与安全

- 无新后端 API；沿用既有登录后创建任务权限
- 选元素仅读宿主 DOM 公开属性，不采集密码框 value（仅 tag/结构/可见文本截断）
- 密码类 input：文本字段记为 `[敏感输入已省略]`

## 10. 变更记录

- 2026-07-13：初版设计（goal-mode 自动批准）
