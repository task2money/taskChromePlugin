'use strict';

/**
 * Saved skills 列表结构：不应用 Option 带 radio；标题独占一行；按钮在下一行。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { installTxRuntime } = require('./helpers/txRuntime.js');

function makeEl(tag) {
  const handlers = Object.create(null);
  const attrs = Object.create(null);
  let text = '';
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    className: '',
    value: '',
    checked: false,
    options: [],
    type: '',
    name: '',
    id: '',
    href: '',
    target: '',
    rel: '',
    get textContent() { return text; },
    set textContent(v) { text = String(v); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type, ev) { (handlers[type] || []).forEach((fn) => fn(ev || {})); },
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    innerHTML: '',
  };
  return el;
}

function titleLine(row) { return row.children[0]; }
/** 组内结构：[h4, 类别来源单选行, ...skill 行]（OPT-20260922-043）。 */
function categorySourceRow(group) { return group.children[1]; }
function actionsLine(row) { return row.children[1]; }
function categoryBox(root) {
  return root.children.find((c) => String(c.className || '').includes('popup-skill-categories'));
}
function openTendency(root, tendency) {
  const btn = categoryBox(root).children.find((b) => b.getAttribute('data-tendency') === tendency);
  btn.dispatch('click', {});
}
function tendencyGroup(root) {
  return root.children.find((c) => c.getAttribute && c.getAttribute('data-tendency'));
}
function collectText(el) {
  let out = String((el && el.textContent) || '');
  (el && el.children || []).forEach((ch) => { out += collectText(ch); });
  return out;
}

describe('PopupPromptSkillUi.renderSkillList 布局', () => {
  let SkillUi;

  beforeEach(() => {
    installTxRuntime();
    delete require.cache[require.resolve('../lib/page-advisor-preset-skills.js')];
    delete require.cache[require.resolve('../lib/page-advisor-prompt-skills.js')];
    require('../lib/page-advisor-prompt-skills.js');
    global.document = { createElement: makeEl };
    delete require.cache[require.resolve('../popup/popup-prompt-skill-ui.js')];
    SkillUi = require('../popup/popup-prompt-skill-ui.js');
  });

  it('无 Skill 时仍渲染「不应用」radio，默认勾选，并只列出五类、不列出技能', () => {
    const root = makeEl('div');
    const calls = [];
    SkillUi.renderSkillList(root, { skills: [], activeSkillId: '' }, 'local', [], {
      onActive: (id) => calls.push(id),
    });
    assert.equal(root.children.length, 3, '不应用 + 步骤说明 + 类别列表');
    const none = root.children[0];
    assert.match(none.className, /popup-skill-row-none/);
    const radio = titleLine(none).children[0];
    assert.equal(radio.type, 'radio');
    assert.equal(radio.name, 'popupSkillActive');
    assert.equal(radio.value, '');
    assert.equal(radio.checked, true);
    assert.match(titleLine(none).children[1].textContent, /不应用/);
    assert.equal(none.children.length, 1, '不应用行没有操作按钮行');
    radio.dispatch('change');
    assert.deepEqual(calls, ['']);
    const picks = categoryBox(root).children;
    assert.equal(picks.length, 5);
    assert.equal(picks[0].getAttribute('data-tendency'), 'a11y');
    assert.match(picks[0].textContent, /无障碍|Accessibility/);
    assert.equal(root.children.some((c) => String(c.className || '').includes('popup-skill-group')), false);
    assert.match(root.children[1].textContent, /先选择类别|Choose a category/);
  });

  it('Skill 行标题独占第一行，同步/编辑/删除在标题下一行', () => {
    const root = makeEl('div');
    const deleted = [];
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: '严谨', tendency: 'custom', body: 'x', syncTarget: 'local' }],
      activeSkillId: 's1',
    }, 'local', [], {
      onActive() {},
      onTarget() {},
      onEdit() {},
      onDelete: (sk) => deleted.push(sk.id),
    });
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    const skillRow = customGroup.children[2];
    assert.match(skillRow.className, /popup-skill-row/);
    assert.doesNotMatch(skillRow.className, /popup-skill-row-none/);
    const title = titleLine(skillRow);
    assert.match(title.className, /popup-skill-row-title/);
    assert.equal(title.children[0].type, 'radio');
    assert.match(title.children[1].textContent, /严谨/);
    const actions = actionsLine(skillRow);
    assert.match(actions.className, /popup-skill-row-actions/);
    assert.equal(actions.children[0].tagName, 'SELECT');
    assert.equal(actions.children[1].textContent, '编辑');
    assert.equal(actions.children[2].textContent, '删除');
    actions.children[2].dispatch('click', { stopPropagation() {} });
    assert.deepEqual(deleted, ['s1']);
  });

  it('系统 Skill 不渲染删除并带系统徽章', () => {
    const root = makeEl('div');
    const deleted = [];
    SkillUi.renderSkillList(root, {
      skills: [{
        id: 'sys_default_auto_innovate',
        title: '系统默认自动创新',
        tendency: 'custom',
        body: 'p',
        readonly: true,
      }],
      activeSkillId: 'sys_default_auto_innovate',
    }, 'local', [], {
      onActive() {},
      onTarget() {},
      onEdit() {},
      onDelete: (sk) => deleted.push(sk.id),
    }, { systemSkillIds: ['sys_default_auto_innovate'] });
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    const skillRow = customGroup.children[2];
    const actions = actionsLine(skillRow);
    assert.equal(actions.children.length, 2, '仅同步下拉与编辑，无删除');
    assert.equal(actions.children[0].disabled, true);
    assert.match(titleLine(skillRow).children[titleLine(skillRow).children.length - 1].textContent, /系统|System/);
    assert.equal(deleted.length, 0);
  });

  it('已有 active Skill 时「不应用」radio 未勾选', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: 'A', tendency: 'custom', body: 'x' }],
      activeSkillId: 's1',
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    assert.equal(titleLine(root.children[0]).children[0].checked, false);
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    assert.equal(titleLine(customGroup.children[2]).children[0].checked, true);
  });

  it('标题文案用 <label for> 关联 radio，点标题即选中（WCAG 标签关联）', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: '严谨', tendency: 'custom', body: 'x' }],
      activeSkillId: '',
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    const noneTitle = titleLine(root.children[0]);
    assert.equal(noneTitle.children[1].tagName, 'LABEL', '不应用行标题为 label');
    assert.equal(noneTitle.children[0].id, 'popupSkillRadio_none');
    assert.equal(noneTitle.children[1].htmlFor, noneTitle.children[0].id, 'label for 与 radio id 对齐');
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    const skillTitle = titleLine(customGroup.children[2]);
    assert.equal(skillTitle.children[1].tagName, 'LABEL', 'Skill 行标题为 label');
    assert.equal(skillTitle.children[0].id, 'popupSkillRadio_s1');
    assert.equal(skillTitle.children[1].htmlFor, skillTitle.children[0].id);
    assert.match(skillTitle.children[1].textContent, /严谨/);
  });

  it('fillTendencyDatalist 含建议值与已用自定义类别', () => {
    const list = makeEl('datalist');
    SkillUi.fillTendencyDatalist(list, [{ tendency: '品牌' }]);
    assert.match(list.innerHTML, /value="a11y"/);
    assert.match(list.innerHTML, /value="品牌"/);
  });

  it('标题行末尾链接指向对应工作空间提示词管理页；不应用行没有该按钮', () => {
    const root = makeEl('div');
    const missing = [];
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: '云端条', tendency: 'custom', body: 'x', syncTarget: 'ws-b' }],
      activeSkillId: 's1',
    }, 'local', [{ id: 'ws-b', name: '空间B', company_id: 'co1' }], {
      onActive() {},
      onTarget() {},
      onEdit() {},
      onDelete() {},
      onMissingWorkspace: () => missing.push(1),
    }, { baseUrl: 'https://aidevpush.com', lastWorkspaceId: 'ws-a' });
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    const title = titleLine(customGroup.children[2]);
    const link = title.children[2];
    assert.equal(link.tagName, 'A');
    assert.equal(
      link.href,
      'https://aidevpush.com/tenant/co1/settings/workspace/ws-b/prompt-skills/',
    );
    assert.match(link.textContent, /管理|Manage/);
    assert.equal(titleLine(root.children[0]).children.length, 2, '不应用行标题末尾无跳转');
    assert.equal(missing.length, 0);
  });
});

describe('预设类别来源单选（OPT-20260922-043）', () => {
  let SkillUi;

  beforeEach(() => {
    installTxRuntime();
    delete require.cache[require.resolve('../lib/page-advisor-preset-skills.js')];
    delete require.cache[require.resolve('../lib/page-advisor-prompt-skills.js')];
    require('../lib/page-advisor-prompt-skills.js');
    global.document = { createElement: makeEl };
    delete require.cache[require.resolve('../popup/popup-prompt-skill-ui.js')];
    SkillUi = require('../popup/popup-prompt-skill-ui.js');
  });

  function sourceRadios(group) {
    return categorySourceRow(group).children.filter((el) => el.type === 'radio');
  }

  it('每个预设类别在点进之后才渲染系统/定制两个 radio，默认勾系统', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, { skills: [], activeSkillId: '' }, 'local', [], {
      onActive() {}, onTarget() {}, onEdit() {}, onDelete() {},
    });
    const tendencies = categoryBox(root).children.map((b) => b.getAttribute('data-tendency'));
    assert.deepEqual(tendencies, ['a11y', 'conversion', 'perf', 'seo', 'custom']);
    assert.equal(root.children.some((c) => String(c.className || '').includes('popup-skill-category-source')), false);
    for (const tendency of tendencies) {
      openTendency(root, tendency);
      const group = tendencyGroup(root);
      const radios = sourceRadios(group);
      assert.deepEqual(radios.map((r) => r.value), ['system', 'custom']);
      assert.equal(radios[0].checked, true);
      assert.equal(radios[1].checked, false);
      assert.equal(categorySourceRow(group).getAttribute('role'), 'radiogroup');
      assert.ok(radioId(radios[0]).endsWith('_system'));
      root.children.find((c) => String(c.className || '').includes('popup-skill-back')).dispatch('click', {});
    }
  });

  function radioId(radio) { return String(radio.id || ''); }

  it('categoryChoices 为 custom 时勾选定制项', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [{ id: 'c1', title: '本机稿', tendency: 'seo', body: 'x' }],
      activeSkillId: '',
      categoryChoices: [{ tendency: 'seo', source: 'custom', customSkillId: 'c1' }],
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    openTendency(root, 'seo');
    const seo = tendencyGroup(root);
    const radios = sourceRadios(seo);
    assert.equal(radios.find((r) => r.value === 'custom').checked, true);
    assert.equal(radios.find((r) => r.value === 'system').checked, false);
  });

  it('点定制派发 onCategorySource(类别, custom)', () => {
    const root = makeEl('div');
    const seen = [];
    SkillUi.renderSkillList(root, { skills: [], activeSkillId: '' }, 'local', [], {
      onActive() {}, onTarget() {}, onEdit() {}, onDelete() {},
      onCategorySource: (tendency, source) => seen.push([tendency, source]),
    });
    openTendency(root, 'a11y');
    const a11y = tendencyGroup(root);
    sourceRadios(a11y).find((r) => r.value === 'custom').dispatch('change');
    assert.deepEqual(seen, [['a11y', 'custom']]);
  });

  it('类别层不出现技能标题；点进类别后不再出现类别按钮；返回后技能消失', () => {
    const root = makeEl('div');
    const store = {
      skills: [{ id: 's1', title: '严谨排障', tendency: 'custom', body: 'x' }],
      activeSkillId: 's1',
    };
    const handlers = { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} };
    SkillUi.renderSkillList(root, store, 'local', [], handlers);
    const flat = collectText(root);
    assert.match(flat, /自定义/);
    assert.doesNotMatch(flat, /严谨排障/);
    const customBtn = categoryBox(root).children.find((b) => b.getAttribute('data-tendency') === 'custom');
    assert.match(customBtn.className, /popup-skill-category-pick-active/);
    assert.match(customBtn.textContent, /当前应用/);
    openTendency(root, 'custom');
    assert.equal(categoryBox(root), undefined);
    assert.match(collectText(tendencyGroup(root)), /严谨排障/);
    root.children.find((c) => String(c.className || '').includes('popup-skill-back')).dispatch('click', {});
    assert.ok(categoryBox(root));
    assert.doesNotMatch(collectText(root), /严谨排障/);
  });

  it('再次打开设置时回到类别列表', () => {
    const root = makeEl('div');
    const store = {
      skills: [{ id: 's1', title: '严谨排障', tendency: 'custom', body: 'x' }],
      activeSkillId: '',
    };
    const handlers = { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} };
    const render = () => SkillUi.renderSkillList(root, store, 'local', [], handlers);
    render();
    openTendency(root, 'custom');
    assert.match(collectText(tendencyGroup(root)), /严谨排障/);
    const fields = { hidden: true, style: { display: 'none' } };
    let toggled = 0;
    SkillUi.onSkillSettingsToggle({
      toggleLlmSettingsExpanded() { toggled += 1; },
    }, fields, makeEl('button'), render);
    assert.equal(toggled, 1);
    assert.ok(categoryBox(root));
    assert.doesNotMatch(collectText(root), /严谨排障/);
  });
});
