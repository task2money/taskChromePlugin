# taskChromePlugin：指针 ⌘/Ctrl 累加多选（不关联元素）

**日期**: 2026-07-18  
**状态**: 已批准（对话确认交互 / 描述格式 / 改动面）  
**作者**: cursor-grok  
**关联**: 取代悬浮面板「Shift+同父兄弟区间」多选（见 `docs/2026-07-18-task-chrome-plugin-sibling-range-pick-design.md`）

## 1. 目标与成功标准

在悬浮面板「指针选择」中，支持通过 **⌘/Ctrl + 点击** 累加选中**多个彼此无兄弟/同父关系要求的页面元素**，确认后写入**一块**任务描述（共用一段调整期望）。

| # | 成功标准 | 可验证方式 |
|---|----------|------------|
| S1 | ⌘/Ctrl+点击可累加 / 再次点击已选中元素可取消；高亮正确 | 手动 |
| S2 | Enter 在集合非空时结束指针模式并打开调整弹窗；描述为一块、含元素列表 + 共用期望 | 手动 / 单测 |
| S3 | 普通单击仍为单选并立即出窗（不回归） | 手动 / 单测 |
| S4 | 勾选截图时截取全部选中元素包围盒并集（一张） | 手动 |
| S5 | Shift 不再触发兄弟区间多选；`USER_GUIDE.md` / `lib/user-guide.js` 文案已替换为 ⌘/Ctrl | 文档 + 单测 |
| S6 | Esc：若有累加集合则先清空；集合已空则退出指针模式 | 手动 |
| S7 | 累加仅限同一 frame；跨 frame 拒绝加入并提示 | 手动 |
| S8 | `npm test` 通过 | CI / 本地 |

## 2. 方案选型

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 累加会话 + `snapshotDisjointSelection` | ⌘/Ctrl 增删、Enter 确认；描述用 `elements[]`；下线 Shift 兄弟区间 | ✅ 采用 |
| B. 复用 `siblingRange` 硬扩无关元素 | 语义失真，易埋雷 | 否 |
| C. 每元素各开调整窗再合并 | 与「一块共用期望」冲突，交互重 | 否 |

**决策理由**：与文件管理器 / 列表多选心智一致；普通单击行为不变；去掉两套快捷键并存的认知负担。

## 3. 交互契约

| 操作 | 行为 |
|------|------|
| 普通点击 | 清空累加集合 → 单选该元素 → **立即**打开调整弹窗 |
| ⌘/Ctrl + 点击 | 未选中则加入，已选中则移除；**不**结束指针模式 |
| Enter | 集合非空 → 结束指针模式并打开调整弹窗；空集合忽略 |
| Esc | 有累加集合时先清空并保留指针模式；再按或集合已空则退出指针模式 |
| Shift + 点击 | **不再**提供兄弟区间能力（实现与文案一并移除） |

**约束（v1）**

- 累加仅限**同一 frame**（同一主文档或同一同源 iframe）；跨 frame 点选提示并拒绝加入。
- 高亮：悬停单元素 outline + 已选集合多 outline。
- 截图：选中元素 `getBoundingClientRect` 并集一张（可夹带中间无关内容，已接受）。
- DevTools 发起的指针选择与浮窗共用同一套交互（若入口共用 `setPickMode`）。

```
进入 pick 模式
  → 普通点击：单元素快照 → 调整期望弹窗（现有）
  → ⌘/Ctrl+点击：toggle 累加集合，保持 pick，多高亮
  → Enter（集合非空）：snapshotDisjointSelection → 弹窗
  → Esc：先清空集合；再 Esc 或已空 → 退出 pick
```

## 4. 数据形状与描述格式

### 4.1 快照

- **1 个元素**：沿用 `snapshotElement`（`multi: false`）。
- **≥2 个元素**：

```js
{
  multi: true,
  selectionKind: 'disjoint',
  label: '多选 ×N',
  elements: [ /* 各为 snapshotElement 形状 */ ],
  // 可选摘要字段供弹窗 / 截图：
  // cssPath 可省略或为「见各元素」
}
```

- **不再**写入 `siblingRange` / `siblingCount` 作为主路径字段。
- 既有 `snapshotSiblingRange` / `collectContiguousSiblings` 等：实现阶段删除调用方；库函数可删除或标废弃（以无调用为准）。

### 4.2 描述 Markdown

多选（一块、共用期望）：

```markdown
---
**页面元素调整**
- **页面链接**: …
- **页面标题**: …（若有）
- **选择**: 多选 ×N
- **元素 1**: `label`
- **选择器 1**: `cssPath`
- **元素 2**: `label`
- **选择器 2**: `cssPath`
- **调整期望**: …
- **元素截图**:
![element](https://…)
```

单选：保持现网字段名（`- **元素**` / `- **选择器**`），避免破坏已有任务阅读习惯。

各元素若有 Shadow / iframe / UA Shadow 等上下文，按现有单元素规则写在对应元素条目下（或紧随该元素的子弹列表），实现时保持可读即可。

### 4.3 调整弹窗

- 摘要：`多选 ×N` + 各 `label` 短列表。
- 调整期望仍只填一次；「附带元素截图」语义为包围盒并集一张。

## 5. 改动清单

| 文件 | 变更 |
|------|------|
| `content/content.js` | 累加集合、⌘/Ctrl、Enter、Esc 分步；移除 Shift 锚点 / 预览 |
| `content/pick-frame.js` | 与主 frame 对齐的多选消息 / 行为（若当前承载 Shift 区间） |
| `lib/element-picker.js` | `snapshotDisjointSelection`；`formatElementAdjustmentBlock` 支持 `elements[]`；下线兄弟区间主路径 |
| `test/element-picker.test.js` | 累加语义、描述输出；兄弟区间用例删除或改写 |
| `lib/user-guide.js` | 指针章节改为 ⌘/Ctrl 累加 + Enter |
| `docs/USER_GUIDE.md` | 同步 |
| `content/content.css` | 可选：多选高亮样式微调 |
| `manifest.json` | version bump（实现 PR） |

按仓库 `ai.md`：**实现变更必须同 PR 更新** `docs/USER_GUIDE.md` 与 `lib/user-guide.js`。

## 6. 明确不做（v1）

- 跨 frame 混选
- 每个元素单独截图 / 单独调整期望
- 键盘方向键遍历点选
- 保留 Shift 兄弟区间作为第二套快捷键

## 7. 测试要点

- `formatElementAdjustmentBlock`：`selectionKind: 'disjoint'` 输出元素列表与共用期望；单选路径不变。
- `snapshotDisjointSelection`：≥2 要求；同 frame；顺序稳定（文档序或点击序，实现时选定并单测锁定——**推荐点击累加序**）。
- user-guide：章节仍含指针说明，且匹配 ⌘/Ctrl / Enter，不再宣称 Shift 兄弟区间。

## 8. 架构影响

- 无新 Chrome 权限。
- 纯逻辑优先落在 `lib/element-picker.js` 以便单测；content 仅管会话状态与 DOM 事件。
- 与「兄弟区间」设计文档的关系：本能力**产品上取代**浮窗侧 Shift 兄弟多选；历史文档保留作考古，实现以本文为准。
