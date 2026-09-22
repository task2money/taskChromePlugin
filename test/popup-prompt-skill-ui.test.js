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
    get textContent() { return text; },
    set textContent(v) { text = String(v); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type, ev) { (handlers[type] || []).forEach((fn) => fn(ev || {})); },
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
  };
  return el;
}

function titleLine(row) { return row.children[0]; }
function actionsLine(row) { return row.children[1]; }

describe('PopupPromptSkillUi.renderSkillList 布局', () => {
  let SkillUi;

  beforeEach(() => {
    installTxRuntime();
    global.document = { createElement: makeEl };
    delete require.cache[require.resolve('../popup/popup-prompt-skill-ui.js')];
    SkillUi = require('../popup/popup-prompt-skill-ui.js');
  });

  it('无 Skill 时仍渲染「不应用」radio Option，且默认勾选', () => {
    const root = makeEl('div');
    const calls = [];
    SkillUi.renderSkillList(root, { skills: [], activeSkillId: '' }, 'local', [], {
      onActive: (id) => calls.push(id),
    });
    assert.equal(root.children.length, 1);
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
    assert.equal(root.children.length, 2);
    const skillRow = root.children[1];
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

  it('已有 active Skill 时「不应用」radio 未勾选', () => {
    const root = makeEl('div');
    SkillUi.renderSkillList(root, {
      skills: [{ id: 's1', title: 'A', tendency: 'custom', body: 'x' }],
      activeSkillId: 's1',
    }, 'local', [], { onActive() {}, onTarget() {}, onEdit() {}, onDelete() {} });
    assert.equal(titleLine(root.children[0]).children[0].checked, false);
    assert.equal(titleLine(root.children[1]).children[0].checked, true);
  });
});
