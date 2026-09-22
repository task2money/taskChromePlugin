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
function actionsLine(row) { return row.children[1]; }

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

  it('无 Skill 时仍渲染「不应用」radio Option，且默认勾选，并有五类空分组', () => {
    const root = makeEl('div');
    const calls = [];
    SkillUi.renderSkillList(root, { skills: [], activeSkillId: '' }, 'local', [], {
      onActive: (id) => calls.push(id),
    });
    assert.equal(root.children.length, 6);
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
    const groups = root.children.slice(1);
    assert.equal(groups.length, 5);
    assert.equal(groups[0].getAttribute('data-tendency'), 'a11y');
    assert.match(groups[0].children[0].textContent, /无障碍|Accessibility/);
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
    assert.equal(root.children.length, 6);
    const customGroup = root.children.find((c) => c.getAttribute && c.getAttribute('data-tendency') === 'custom');
    const skillRow = customGroup.children[1];
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
    const customGroup = root.children.find((c) => c.getAttribute && c.getAttribute('data-tendency') === 'custom');
    const skillRow = customGroup.children[1];
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
    const customGroup = root.children.find((c) => c.getAttribute && c.getAttribute('data-tendency') === 'custom');
    assert.equal(titleLine(customGroup.children[1]).children[0].checked, true);
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
    const customGroup = root.children.find((c) => c.getAttribute && c.getAttribute('data-tendency') === 'custom');
    const title = titleLine(customGroup.children[1]);
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