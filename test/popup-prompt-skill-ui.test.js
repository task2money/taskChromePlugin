'use strict';

/**
 * Saved skills 列表结构：没有「不应用」行；标题独占一行；按钮在下一行。
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
/** 组内结构：[h4, ...skill 行]。 */
function skillRowInGroup(group) { return group.children[1]; }
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

  it('无 Skill 时只列出五类、不列出技能，也没有「不应用」', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, { skills: [], activeSkillId: '' }, 'local', [], {
      onActive() {},
    });
    assert.equal(root.children.length, 2, '步骤说明 + 类别列表');
    assert.equal(root.children.some((c) => String(c.className || '').includes('popup-skill-row-none')), false);
    assert.doesNotMatch(collectText(root), /不应用/);
    const picks = categoryBox(root).children;
    assert.equal(picks.length, 5);
    assert.equal(picks[0].getAttribute('data-tendency'), 'a11y');
    assert.match(picks[0].textContent, /无障碍|Accessibility/);
    assert.equal(root.children.some((c) => String(c.className || '').includes('popup-skill-group')), false);
    assert.match(root.children[0].textContent, /先选择类别|Choose a category/);
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
    const skillRow = skillRowInGroup(customGroup);
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
    const skillRow = skillRowInGroup(customGroup);
    const actions = actionsLine(skillRow);
    assert.equal(actions.children.length, 2, '仅同步下拉与编辑，无删除');
    assert.equal(actions.children[0].disabled, true);
    assert.match(titleLine(skillRow).children[titleLine(skillRow).children.length - 1].textContent, /系统|System/);
    assert.equal(deleted.length, 0);
  });

  it('已有 active Skill 时该类技能 radio 勾选，列表没有「不应用」', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: 'A', tendency: 'custom', body: 'x' }],
      activeSkillId: 's1',
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    assert.doesNotMatch(collectText(root), /不应用/);
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    assert.equal(titleLine(skillRowInGroup(customGroup)).children[0].checked, true);
  });

  it('标题文案用 <label for> 关联 radio，点标题即选中（WCAG 标签关联）', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: '严谨', tendency: 'custom', body: 'x' }],
      activeSkillId: '',
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    openTendency(root, 'custom');
    const customGroup = tendencyGroup(root);
    const skillTitle = titleLine(skillRowInGroup(customGroup));
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
    const title = titleLine(skillRowInGroup(customGroup));
    const link = title.children[2];
    assert.equal(link.tagName, 'A');
    assert.equal(
      link.href,
      'https://aidevpush.com/tenant/co1/settings/workspace/ws-b/prompt-skills/',
    );
    assert.match(link.textContent, /管理|Manage/);
    assert.doesNotMatch(collectText(root), /不应用/);
    assert.equal(missing.length, 0);
  });
});

describe('点进类别后直接列出技能', () => {
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

  it('技能行紧跟标题，没有系统默认/自行定制单选', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [
        { id: 'sys', title: '系统默认·无障碍', tendency: 'a11y', body: 's', readonly: true },
        { id: 'mine', title: '我的无障碍', tendency: 'a11y', body: 'm' },
      ],
      activeSkillId: '',
      categoryChoices: [{ tendency: 'a11y', source: 'custom', customSkillId: 'mine' }],
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    openTendency(root, 'a11y');
    const group = tendencyGroup(root);
    assert.doesNotMatch(collectText(group), /自行定制/);
    assert.equal(group.children.some((c) => String(c.className || '').includes('popup-skill-category-source')), false);
    assert.match(skillRowInGroup(group).className, /popup-skill-row/);
    assert.match(collectText(group), /系统默认·无障碍/);
    assert.match(collectText(group), /我的无障碍/);
    assert.equal(SkillUi.currentBrowseTendency(), 'a11y');
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

/**
 * OPT-20260927-012: 集市入口常驻「提示词 Skill」标题行。
 * 这里只锁 showSignedOutPromptMarketLink 的契约：只改标题行链接的 href，
 * 不重建节点、不写状态行（状态行只放保存/同步结果）。
 */
describe('PopupPromptSkillUi.showSignedOutPromptMarketLink', () => {
  let SkillUi;
  let market;
  let status;

  beforeEach(() => {
    installTxRuntime();
    delete require.cache[require.resolve('../lib/page-advisor-prompt-skills.js')];
    require('../lib/page-advisor-prompt-skills.js');
    market = makeEl('a');
    market.id = 'lnkPromptMarket';
    market.textContent = '提示词集市';
    market.href = 'https://www.aidevpush.com/prompt-shares/';
    market.target = '_blank';
    market.rel = 'noopener noreferrer';
    status = makeEl('p');
    status.id = 'popupSkillStatus';
    status.textContent = '已保存';
    global.document = {
      createElement: makeEl,
      querySelector: (sel) => (sel === '#lnkPromptMarket' ? market : null),
    };
    delete require.cache[require.resolve('../popup/popup-prompt-skill-ui.js')];
    SkillUi = require('../popup/popup-prompt-skill-ui.js');
  });

  it('只更新标题行链接的 href，不动文案/目标属性与状态行', () => {
    SkillUi.showSignedOutPromptMarketLink('');

    assert.equal(market.href, 'https://www.aidevpush.com/prompt-shares/');
    assert.equal(market.textContent, '提示词集市', '文案来自静态标记，这里不得改写');
    assert.equal(market.target, '_blank');
    assert.equal(market.rel, 'noopener noreferrer');
    assert.equal(market.children.length, 0, '不得再往链接里塞子节点');
    assert.equal(status.textContent, '已保存', '状态行不得被集市入口覆盖');
  });

  it('baseUrl 指向自建站点时链接落到该站点', () => {
    SkillUi.showSignedOutPromptMarketLink('https://saas.example/');
    assert.equal(market.href, 'https://saas.example/prompt-shares/');
  });

  it('标题行没有该链接时安全返回，不抛异常', () => {
    global.document.querySelector = () => null;
    assert.doesNotThrow(() => SkillUi.showSignedOutPromptMarketLink('https://saas.example/'));
  });
});
