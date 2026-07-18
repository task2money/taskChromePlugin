# taskChromePlugin：列表环境相邻兄弟多选

**日期**: 2026-07-18  
**状态**: 已批准（goal-mode 自动采用）  
**作者**: cursor-grok

## 1. 目标与成功标准

在悬浮面板「指针选择」中，支持在**同一父节点下的列表/兄弟结构**内一次选中**连续相邻**的多个兄弟节点，并写入任务描述。

| # | 成功标准 | 可验证方式 |
|---|----------|------------|
| S1 | 普通点击仍为单元素选择（不回归） | 手动 / 单测 |
| S2 | Shift+点击锚定起点；再 Shift+点击同父兄弟完成连续区间 | 手动 |
| S3 | 锚定后 Shift+悬停预览区间高亮（多元素 outline） | 手动 |
| S4 | 跨父节点 / 非兄弟的第二次 Shift+点击重置为新锚点 | 手动 |
| S5 | 描述块含多选标签、区间选择器、兄弟数量 | 单测 |
| S6 | iframe（pick-frame）同样支持 Shift 区间 | 逻辑对齐 |
| S7 | `npm test` 通过 | CI / 本地 |

## 2. 方案选型（自动决策）

| 方案 | 说明 | 结论 |
|------|------|------|
| A. Shift+两次点击定区间 | 与编辑器「Shift 选范围」心智一致；不改变普通单击 | ✅ 采用 |
| B. 拖拽框选 | 易与页面拖拽/滚动冲突 | 否 |
| C. 自动识别 list 容器并一键全选 | 误选风险高，非「相邻子集」 | 否 |

**决策理由**：列表场景最常见需求是「从第 i 项到第 j 项」；Shift 锚定 + 二次确认零新权限、改动面可控。

## 3. 交互流程

```
进入 pick 模式
  → 普通点击：单元素快照 → 调整期望弹窗（现有行为）
  → Shift+点击元素 A：锚定 A，保持 pick，高亮 A；提示再选终点
  → Shift+悬停同父兄弟 B：预览 A…B 区间高亮
  → Shift+点击同父兄弟 B：snapshotSiblingRange(A…B) → 弹窗
  → Shift+点击非兄弟：重置锚点为新元素
  → Esc：清除锚点并退出 pick（与现有一致）
```

## 4. 选择器与描述格式

同 tag 兄弟区间（优先）：

```text
ul.list > li.item:nth-of-type(n+2):nth-of-type(-n+5)
```

混合 tag 时退化为：

```text
.parent > :nth-child(n+2):nth-child(-n+5)
```

描述块增量字段：

```markdown
- **元素**: `li.item ×3`
- **选择器**: `ul.list > li.item:nth-of-type(n+2):nth-of-type(-n+4)`
- **兄弟区间**: 第 2–4 项（共 3 个）
```

截图视口矩形取区间元素 `getBoundingClientRect` 的并集。

## 5. 改动清单

| 文件 | 变更 |
|------|------|
| `lib/element-picker.js` | `collectContiguousSiblings` / `buildSiblingRangeCssPath` / `snapshotSiblingRange` / `unionClientRects`；`formatElementAdjustmentBlock` 支持 multi |
| `test/element-picker.test.js` | 兄弟区间单测 |
| `content/content.js` | 多高亮、Shift 锚点、区间完成 |
| `content/pick-frame.js` | 同上（iframe） |
| `content/content.css` | 可选：多选高亮微调 |
| `manifest.json` | version bump |
| README / intents | 需求留痕 |

## 6. 架构变更影响

- **判定**: 不更新 `docs/architecture/`
- **理由**: 仅扩展既有 content script 指针选择；无新服务/接口/数据流

## 7. 领域概念（轻量）

| 概念 | 说明 |
|------|------|
| SiblingRange | 同父下连续元素兄弟区间 |
| RangeAnchor | pick 会话内 Shift 锚定的起点元素 |
| ElementSnapshot.multi | 多选快照标志与 siblingRange 元数据 |
