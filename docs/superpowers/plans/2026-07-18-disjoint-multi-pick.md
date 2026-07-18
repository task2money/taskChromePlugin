# Disjoint Multi-Pick (⌘/Ctrl) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 悬浮面板指针模式支持 ⌘/Ctrl+点击累加多个不关联元素，Enter 确认后写入一块共用期望的描述；并下线 Shift 兄弟区间多选。

**Architecture:** 纯逻辑落在 `lib/element-picker.js`（`snapshotDisjointSelection` + 描述格式化 + 可选集合 toggle 助手）；`content/content.js` 与 `content/pick-frame.js` 维护累加会话与 DOM 事件；指南双 SSOT（`USER_GUIDE.md` + `user-guide.js`）同步。

**Tech Stack:** Chrome MV3 content scripts、原生 DOM 事件、`node:test` 单测、现有 `ElementPicker` 模块模式。

**Spec:** [`docs/2026-07-18-task-chrome-plugin-disjoint-multi-pick-design.md`](../../2026-07-18-task-chrome-plugin-disjoint-multi-pick-design.md)

## Global Constraints

- 累加仅限同一 frame；跨 frame 拒绝加入。
- 元素列表顺序 = **点击累加序**（非文档序）。
- 普通单击仍立即单选出窗；⌘/Ctrl+点击不结束 pick。
- Esc：先清空累加，再退出 pick。
- Shift 兄弟区间产品下线（删除调用与文案；库内兄弟辅助函数可删或保留但无调用）。
- 截图：选中元素包围盒并集一张（已有 `unionClientRects`）。
- 实现 PR 必须同步 `docs/USER_GUIDE.md` 与 `lib/user-guide.js`（仓库 `ai.md`）。
- `manifest.json` version bump（当前 `1.6.8` → `1.6.9`）。

## File Structure

| 文件 | 职责 |
|------|------|
| `lib/element-picker.js` | `toggleDisjointSelection`、`snapshotDisjointSelection`、扩展 `formatElementAdjustmentBlock`；移除对 sibling 主路径的依赖（可删 sibling helpers） |
| `test/element-picker.test.js` | 新多选契约单测；改写/删除 sibling range 用例 |
| `content/content.js` | 顶层 pick 会话：集合、⌘/Ctrl、Enter、Esc 分步、高亮、同 frame 校验 |
| `content/pick-frame.js` | iframe 内同样累加 + Enter relay；去掉 Shift |
| `lib/user-guide.js` / `docs/USER_GUIDE.md` | 文案 |
| `manifest.json` | version + 无新脚本依赖 |

---

### Task 1: `snapshotDisjointSelection` + 描述格式化（纯函数，TDD）

**Files:**
- Modify: `lib/element-picker.js`
- Test: `test/element-picker.test.js`

**Interfaces:**
- Produces:
  - `toggleDisjointSelection(selected: Element[], el: Element): Element[]` — 若 `el` 已在数组中则移除，否则追加到末尾；返回新数组（不改入参）。
  - `snapshotDisjointSelection(elements: Element[], options?: object): object` — `elements.length === 0` 抛错；`=== 1` 等价 `snapshotElement`；`>= 2` 返回：
    ```js
    {
      multi: true,
      selectionKind: 'disjoint',
      label: `多选 ×${n}`,
      elements: ElementSnapshot[], // 各 snapshotElement，顺序 = 传入序
      // 聚合布尔（供弹窗摘要）：inShadow / inIframe / … 任一为真则真
      // cssPath: 可省略或空字符串
      visibleText: 各 visibleText 用 ' | ' 拼接后 truncate
    }
    ```
  - `formatElementAdjustmentBlock`：当 `element.selectionKind === 'disjoint'` 且 `element.elements?.length >= 2` 时输出「选择: 多选 ×N」+「元素 i / 选择器 i」；**不再**要求 `siblingRange`。单选路径不变。

- [ ] **Step 1: Write the failing tests**

在 `test/element-picker.test.js` 增加（并更新顶部解构导入）：

```js
describe('disjoint multi pick', () => {
  it('toggleDisjointSelection appends then removes in click order', () => {
    const { els } = makeSiblingList(['div', 'span', 'p']);
    let sel = [];
    sel = toggleDisjointSelection(sel, els[0]);
    sel = toggleDisjointSelection(sel, els[2]);
    sel = toggleDisjointSelection(sel, els[1]);
    assert.deepEqual(sel.map((e) => e.tagName), ['DIV', 'P', 'SPAN']);
    sel = toggleDisjointSelection(sel, els[2]);
    assert.deepEqual(sel.map((e) => e.tagName), ['DIV', 'SPAN']);
  });

  it('snapshotDisjointSelection marks selectionKind and preserves click order', () => {
    const { els } = makeSiblingList(['div', 'span', 'p']);
    const snap = snapshotDisjointSelection([els[2], els[0]]);
    assert.equal(snap.multi, true);
    assert.equal(snap.selectionKind, 'disjoint');
    assert.equal(snap.label, '多选 ×2');
    assert.equal(snap.elements.length, 2);
    assert.equal(snap.elements[0].tagName, 'p');
    assert.equal(snap.elements[1].tagName, 'div');
  });

  it('snapshotDisjointSelection with one element matches snapshotElement', () => {
    const { els } = makeSiblingList(['div', 'span']);
    const multi = snapshotDisjointSelection([els[0]]);
    const single = snapshotElement(els[0]);
    assert.equal(multi.label, single.label);
    assert.equal(multi.cssPath, single.cssPath);
    assert.equal(multi.selectionKind, undefined);
  });

  it('formatElementAdjustmentBlock lists disjoint elements with shared adjustment', () => {
    const block = formatElementAdjustmentBlock({
      pageUrl: 'https://a.test/',
      element: {
        multi: true,
        selectionKind: 'disjoint',
        label: '多选 ×2',
        elements: [
          { label: 'button.save', cssPath: 'button.save', visibleText: 'Save' },
          { label: 'a.help', cssPath: 'footer > a.help', visibleText: 'Help' },
        ],
      },
      adjustment: '两个入口都要更明显',
    });
    assert.match(block, /选择.*多选 ×2/);
    assert.match(block, /元素 1.*button\.save/);
    assert.match(block, /选择器 1.*button\.save/);
    assert.match(block, /元素 2.*a\.help/);
    assert.match(block, /两个入口都要更明显/);
    assert.doesNotMatch(block, /兄弟区间/);
  });
});
```

同时将原 `describe('sibling range pick')` 中依赖产品路径的用例改为：
- **保留** `unionClientRects` 测试（仍被截图使用）。
- **删除或改写** `formatElementAdjustmentBlock includes sibling range line`（产品不再输出兄弟区间）。
- 若删除 `snapshotSiblingRange` 导出，则删除对应 sibling 单测；若暂时保留函数但不导出，测试只覆盖仍导出的 API。

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/element-picker.test.js`

Expected: FAIL — `toggleDisjointSelection` / `snapshotDisjointSelection` 未定义，或 format 不匹配。

- [ ] **Step 3: Minimal implementation in `lib/element-picker.js`**

```js
function toggleDisjointSelection(selected, el) {
  const list = Array.isArray(selected) ? selected.slice() : [];
  if (!el || el.nodeType !== 1) return list;
  const idx = list.indexOf(el);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(el);
  return list;
}

function snapshotDisjointSelection(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error('snapshotDisjointSelection: 需要至少一个 Element');
  }
  if (elements.length === 1) {
    return snapshotElement(elements[0], options);
  }
  const snaps = elements.map((el) => snapshotElement(el, options));
  return {
    multi: true,
    selectionKind: 'disjoint',
    label: `多选 ×${snaps.length}`,
    elements: snaps,
    tagName: '*',
    id: '',
    className: '',
    cssPath: '',
    visibleText: truncateText(snaps.map((s) => s.visibleText).filter(Boolean).join(' | ')),
    outerHtmlSnippet: truncateText(
      snaps.map((s) => s.outerHtmlSnippet).filter(Boolean).join(' … '),
      MAX_OUTER,
    ),
    isSensitive: snaps.some((s) => s.isSensitive),
    inShadow: snaps.some((s) => s.inShadow),
    inClosedShadow: snaps.some((s) => s.inClosedShadow) || !!options.closedShadow,
    inIframe: snaps.some((s) => s.inIframe) || !!(options.frameElement || options.inIframe),
    crossOriginIframe: snaps.some((s) => s.crossOriginIframe) || !!options.crossOriginIframe,
    uaShadowHost: snaps.some((s) => s.uaShadowHost),
    uaShadowOpaque: snaps.some((s) => s.uaShadowOpaque),
  };
}
```

在 `formatElementAdjustmentBlock` 中，将原先 `el.multi && el.siblingRange` 分支改为优先处理 disjoint：

```js
if (el.selectionKind === 'disjoint' && Array.isArray(el.elements) && el.elements.length >= 2) {
  lines.push(`- **选择**: 多选 ×${el.elements.length}`);
  el.elements.forEach((item, i) => {
    const n = i + 1;
    if (item?.label) lines.push(`- **元素 ${n}**: \`${item.label}\``);
    if (item?.cssPath) lines.push(`- **选择器 ${n}**: \`${item.cssPath}\``);
    if (item?.visibleText) lines.push(`- **可见文本 ${n}**: "${item.visibleText}"`);
    // 可选：各元素的 shadow/iframe 上下文行，有则写
  });
} else {
  lines.push(`- **元素**: \`${el.label}\``);
  if (el.cssPath) lines.push(`- **选择器**: \`${el.cssPath}\``);
  // 删除兄弟区间输出分支（或仅当 selectionKind 不是 disjoint 且仍有 siblingRange 时保留——产品要求删除）
}
```

导出：`toggleDisjointSelection`、`snapshotDisjointSelection`；从 `ElementPicker` 公共导出中移除（或保留但无调用）`collectContiguousSiblings` / `buildSiblingRangeCssPath` / `buildSiblingRangeLabel` / `snapshotSiblingRange`。**推荐删除**这些函数及其单测，减少双路径；`unionClientRects` 保留。

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/element-picker.test.js`  
Expected: PASS（含新 describe；sibling 用例已对齐）

- [ ] **Step 5: Commit**

```bash
git add lib/element-picker.js test/element-picker.test.js
git commit -m "$(cat <<'EOF'
feat(element-picker): disjoint multi-select snapshot and description format

EOF
)"
```

---

### Task 2: 顶层 `content.js` 累加会话（去掉 Shift）

**Files:**
- Modify: `content/content.js`（pick 状态、`onPickClick` / `onPickMouseOver` / `onPickKeyDown`、`finishPickWithElements`、按钮 title、`openAdjustModal` 摘要）

**Interfaces:**
- Consumes: `ElementPicker.toggleDisjointSelection`、`snapshotDisjointSelection`、`unionClientRects`
- Produces: 会话状态
  - `pickSelection: Element[]`
  - `pickSelectionFrame: Element|null`（锚定第一次累加时的 `frameElement`；顶层为 `null`）
  - 辅助：`clearPickSelection()`、`samePickFrame(a,b)`（已有可复用）、`isMetaClick(e) => e.metaKey || e.ctrlKey`

- [ ] **Step 1: Replace range-anchor state with pickSelection**

删除 `rangeAnchorEl` / `rangeAnchorFrame` / `clearRangeAnchor`。新增：

```js
let pickSelection = [];
let pickSelectionFrame = null; // Element|null，与第一次累加的 frameElement 对齐

function clearPickSelection() {
  pickSelection = [];
  pickSelectionFrame = null;
}

function isMetaClick(e) {
  return !!(e && (e.metaKey || e.ctrlKey));
}
```

在 `setPickMode(false)` / 进入 pick 时调用 `clearPickSelection()`。

- [ ] **Step 2: Rewrite mouseover highlight**

```js
function onPickMouseOver(e) {
  if (!pickMode || typeof ElementPicker === 'undefined') return;
  const { el, frameElement, crossOrigin } = resolvePickTarget(e);
  if (crossOrigin || !el || isPluginDom(el)) {
    // 仍显示已选集合高亮（若同文档）
    if (pickSelection.length) applyHighlightMany(pickSelection, pickSelection[0].ownerDocument);
    else clearHighlight();
    return;
  }
  const hoverSet = pickSelection.includes(el)
    ? pickSelection
    : pickSelection.concat([el]);
  applyHighlightMany(hoverSet, el.ownerDocument);
}
```

- [ ] **Step 3: Rewrite click handler**

```js
function onPickClick(e) {
  // …现有 crossOrigin / plugin 守卫…
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  try {
    if (isMetaClick(e)) {
      if (pickSelection.length > 0 && !samePickFrame(frameElement, pickSelectionFrame)) {
        showResult('多选仅限同一 frame，请先清空或在同一框架内选择', 'error');
        return;
      }
      if (pickSelection.length === 0) pickSelectionFrame = frameElement || null;
      pickSelection = ElementPicker.toggleDisjointSelection(pickSelection, el);
      if (pickSelection.length === 0) pickSelectionFrame = null;
      applyHighlightMany(pickSelection.length ? pickSelection : [el], el.ownerDocument);
      const tip = pickSelection.length
        ? `已选 ${pickSelection.length} 个：Enter 确认；⌘/Ctrl+点击继续增删（Esc 清空）`
        : '已清空多选：⌘/Ctrl+点击添加，或普通点击单选';
      btn.title = tip;
      if (pickBtn) pickBtn.title = tip;
      return;
    }

    // 普通点击：立即单选
    clearPickSelection();
    finishPickWithElements([el], frameElement, closedShadow);
  } catch (err) {
    console.warn('[taskChromePlugin] snapshotElement 失败:', err.message || err);
    clearPickSelection();
    setPickMode(false);
  }
}
```

更新 `finishPickWithElements`：

```js
function finishPickWithElements(els, frameElement, closedShadow) {
  const list = (Array.isArray(els) ? els : [els]).filter((el) => el && el.nodeType === 1);
  if (list.length === 0) return;
  pendingFrameElement = frameElement;
  pendingElementSnapshot = list.length === 1
    ? ElementPicker.snapshotElement(list[0], { frameElement, closedShadow })
    : ElementPicker.snapshotDisjointSelection(list, { frameElement, closedShadow });
  pendingElementSnapshot._viewportRect = viewportRectForElements(list, frameElement);
  clearPickSelection();
  setPickMode(false);
  openAdjustModal(pendingElementSnapshot);
}
```

- [ ] **Step 4: Enter + Esc keydown**

```js
function onPickKeyDown(e) {
  if (e.key === 'Enter' && pickMode) {
    if (pickSelection.length === 0) return;
    e.preventDefault();
    const closedShadow = false; // 各元素快照内已带；或从最后一次 resolve 缓存
    finishPickWithElements(pickSelection, pickSelectionFrame, false);
    return;
  }
  if (e.key !== 'Escape') return;
  if (pickMode) {
    e.preventDefault();
    if (pickSelection.length > 0) {
      clearPickSelection();
      clearHighlight();
      const tip = '已清空多选；Esc 再按退出指针模式';
      btn.title = tip;
      if (pickBtn) pickBtn.title = tip;
      return;
    }
    setPickMode(false);
    return;
  }
  if (adjustModal && !adjustModal.hidden) {
    e.preventDefault();
    closeAdjustModal();
  }
}
```

- [ ] **Step 5: Update UI copy + adjust modal summary**

- 按钮默认 title：`指针选择；⌘/Ctrl+点击多选，Enter 确认`
- pick 中 title：去掉一切 Shift 兄弟文案
- `openAdjustModal`：

```js
const ctx = [
  snapshot.selectionKind === 'disjoint' && snapshot.elements?.length
    ? `多选×${snapshot.elements.length}`
    : '',
  // …保留 shadow/iframe 等…
].filter(Boolean).join('+');
let summary = `${snapshot.label}${ctx ? ` [${ctx}]` : ''}`;
if (snapshot.selectionKind === 'disjoint' && Array.isArray(snapshot.elements)) {
  const labels = snapshot.elements.map((x) => x.label).filter(Boolean).join('、');
  if (labels) summary += ` — ${labels}`;
} else if (snapshot.visibleText) {
  summary += ` — "${snapshot.visibleText}"`;
}
adjustElSummary.textContent = summary;
```

- [ ] **Step 6: Manual smoke（实现者本机）**

1. 重载扩展 → 打开浮窗 → 指针选择  
2. 普通点击一元素 → 立即出窗  
3. ⌘/Ctrl 点两个无关元素 → Enter → 摘要「多选×2」→ 确认描述含元素 1/2  
4. Esc 分步清空再退出  

- [ ] **Step 7: Commit**

```bash
git add content/content.js
git commit -m "$(cat <<'EOF'
feat(float): Cmd/Ctrl accumulate multi-pick with Enter confirm

EOF
)"
```

---

### Task 3: `pick-frame.js` 对齐（iframe 内累加）

**Files:**
- Modify: `content/pick-frame.js`

**Interfaces:**
- Consumes: 同 Task 1 API
- Produces: `elementPickedInFrame` 消息中的 snapshot 可为 `selectionKind: 'disjoint'`；`rectInFrame` 为并集

- [ ] **Step 1: Replace Shift range with meta accumulate + Enter**

状态：`pickSelection = []`（iframe 内天然同 document，无需跨 frame 校验）。

```js
function onClick(e) {
  if (!pickMode) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  const { el, closedShadow } = resolveTarget(e);
  if (!el || typeof ElementPicker === 'undefined') {
    setPickMode(false);
    return;
  }

  try {
    if (e.metaKey || e.ctrlKey) {
      pickSelection = ElementPicker.toggleDisjointSelection(pickSelection, el);
      applyHighlightMany(pickSelection.length ? pickSelection : [el]);
      return;
    }
    pickSelection = [];
    const snapshot = ElementPicker.snapshotElement(el, {
      closedShadow,
      inIframe: true,
      crossOriginIframe: true,
    });
    const rect = el.getBoundingClientRect();
    relaySnapshot(snapshot, {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    });
  } catch (err) {
    console.warn('[taskChromePlugin] pick-frame snapshot failed:', err.message || err);
    pickSelection = [];
    setPickMode(false);
  }
}

function onKeyDown(e) {
  if (!pickMode) return;
  if (e.key === 'Enter' && pickSelection.length > 0) {
    e.preventDefault();
    const snapshot = ElementPicker.snapshotDisjointSelection(pickSelection, {
      inIframe: true,
      crossOriginIframe: true,
    });
    relaySnapshot(snapshot, unionRectsInFrame(pickSelection));
    pickSelection = [];
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (pickSelection.length > 0) {
      pickSelection = [];
      clearHighlight();
      return;
    }
    setPickMode(false);
  }
}
```

`onMouseOver`：高亮 `pickSelection` ∪ hover（与顶层一致）；删除全部 `shiftKey` / `rangeAnchorEl` 逻辑。文件头注释改为说明 ⌘/Ctrl 多选。

- [ ] **Step 2: Confirm top-level handler accepts disjoint snapshot from frame**

检查 `content/content.js` 中 `elementPickedInFrame`：应对任意 `msg.snapshot` 调用 `openAdjustModal`；`_viewportRect` 用现有 accumulate 逻辑。若摘要依赖 `siblingCount`，改为识别 `selectionKind === 'disjoint'`（Task 2 已改则此处仅冒烟）。

- [ ] **Step 3: Commit**

```bash
git add content/pick-frame.js content/content.js
git commit -m "$(cat <<'EOF'
feat(pick-frame): Cmd/Ctrl disjoint multi-pick inside iframes

EOF
)"
```

---

### Task 4: 使用说明双 SSOT + version bump

**Files:**
- Modify: `lib/user-guide.js`（`element-pick` steps）
- Modify: `docs/USER_GUIDE.md`
- Modify: `manifest.json`（`"version": "1.6.9"`）
- Test: `test/user-guide.test.js`（若断言含 `Shift`，改为匹配 `Ctrl` 或 `⌘` / `多选`）

- [ ] **Step 1: Update guide copy**

`lib/user-guide.js` `element-pick.steps` 示例：

```js
'在描述旁点击「🖱️ 指针选择」进入选元素模式（十字光标）；Esc 或再次点击可取消。',
'普通点击：选中单个元素 → 填写调整期望 → 确认后追加到任务描述。',
'多选不关联元素：⌘/Ctrl+点击累加（再点取消）→ Enter 确认；Esc 先清空多选，再按退出。多选仅限同一 frame。',
'支持 Shadow DOM（选择器含 >>>）、同源/跨域 iframe、原生控件 UA Shadow（内部不可穿透时选中宿主）。',
'可选「附带元素截图」：裁剪后上传，描述写入 https URL（多选时截取全部选中元素包围盒并集）。',
```

`docs/USER_GUIDE.md` 对应条目同步（删除 Shift 兄弟步骤）。

- [ ] **Step 2: Fix user-guide tests**

Run: `node --test test/user-guide.test.js`  
若失败因匹配 `/Shift/`，改为：

```js
assert.match(html, /Ctrl|⌘|多选/);
assert.doesNotMatch(html, /Shift\+点击/);
```

- [ ] **Step 3: Full test suite + commit**

Run: `npm test`  
Expected: 全部 PASS

```bash
git add lib/user-guide.js docs/USER_GUIDE.md manifest.json test/user-guide.test.js
git commit -m "$(cat <<'EOF'
docs: document Cmd/Ctrl disjoint multi-pick; bump to 1.6.9

EOF
)"
```

---

### Task 5: 回归清单与收尾

- [ ] **Step 1: Spec coverage checklist（手动勾）**

| Spec | Task |
|------|------|
| S1 ⌘/Ctrl 累加/取消 | Task 2–3 |
| S2 Enter + 一块描述 | Task 1–2 |
| S3 普通单击 | Task 2 |
| S4 截图并集 | 现有 `viewportRectForElements` / `unionClientRects` + Task 2 finish |
| S5 下线 Shift + 指南 | Task 2–4 |
| S6 Esc 分步 | Task 2–3 |
| S7 同 frame | Task 2 |
| S8 npm test | Task 4 |

- [ ] **Step 2: Grep 残留**

Run: `rg -n "shiftKey|rangeAnchor|兄弟区间|snapshotSiblingRange|Shift\\+点击" content/ lib/ docs/USER_GUIDE.md`  
Expected: 无产品路径命中（历史 design 文档可保留）。

- [ ] **Step 3: Final commit only if stray fixes remain；否则结束**

---

## Self-Review (plan author)

1. **Spec coverage:** S1–S8 均映射到 Task 1–5；v1 不做项未列入实现步骤。  
2. **Placeholders:** 无 TBD；关键代码块已给出。  
3. **Type consistency:** `selectionKind: 'disjoint'`、`elements[]`、点击累加序在 Task 1–3 一致；`finishPickWithElements` 统一走 `snapshotDisjointSelection`。
