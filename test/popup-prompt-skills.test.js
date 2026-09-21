'use strict';

/**
 * OPT-20260922-002: 弹窗提示词 Skill 的列表渲染与保存门闩。
 *
 * 仓库无 jsdom 依赖（见 test/float-page-advisor.test.js 约定），故按运行时顺序在
 * vm 沙箱里装载真实 lib + popup 脚本，配最小 DOM mock；再回读 popup.html 校验
 * mock 引用的 id 确实存在，避免 mock 与真实 markup 脱节。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { installTxInSandbox } = require('./helpers/txRuntime.js');

const popupHtml = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
const skillsRuntimeSrc = fs.readFileSync(path.join(ROOT, 'lib/page-advisor-prompt-skills.js'), 'utf8');
const popupSkillsSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skills.js'), 'utf8');

/** 被测脚本用到的 popup.html 元素 id。 */
const SKILL_IDS = [
  'pageAdvisorSkillSection',
  'popupSkillList',
  'popupSkillEditingId',
  'popupSkillTitle',
  'popupSkillTendency',
  'popupSkillBody',
  'popupSkillStatus',
  'btnSkillNew',
  'btnSkillSave',
  'btnSkillDelete',
  'btnSkillClearActive',
];

function makeEl(tag, id) {
  const handlers = Object.create(null);
  const attrs = Object.create(null);
  let text = '';
  return {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    children: [],
    style: {},
    className: '',
    value: '',
    checked: false,
    disabled: false,
    get textContent() { return text; },
    set textContent(v) { text = String(v); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    /** 触发已注册监听（事件对象由用例给出）。 */
    dispatch(type, ev) { (handlers[type] || []).forEach((fn) => fn(ev)); },
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function flushAll() {
  for (let i = 0; i < 5; i += 1) await flush();
}

/**
 * 装配沙箱：真实 lib（i18n + PageAdvisorPromptSkills）+ 真实 popup-prompt-skills.js。
 * 不注入 PageAdvisorAPI —— 云端同步/推送按 `typeof` 短路，用例只验本机绑定与落盘。
 */
function bootPopup({ skills = [], activeSkillId = '' } = {}) {
  const byId = Object.create(null);
  SKILL_IDS.forEach((id) => { byId[id] = makeEl(id.startsWith('btn') ? 'button' : 'div', id); });
  const storageSets = [];
  const storage = {
    get: async () => ({ pageAdvisorPromptSkills: skills, pageAdvisorActiveSkillId: activeSkillId }),
    set: async (obj) => { storageSets.push(obj); },
  };

  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      getElementById: (id) => byId[id] || null,
      querySelector: (sel) => (sel.startsWith('#') ? byId[sel.slice(1)] || null : null),
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() {},
      body: makeEl('body'),
    },
    Storage: storage,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  installTxInSandbox(sandbox);
  vm.runInContext(skillsRuntimeSrc, sandbox, { filename: 'lib/page-advisor-prompt-skills.js' });
  vm.runInContext(popupSkillsSrc, sandbox, { filename: 'popup/popup-prompt-skills.js' });

  const skill = (title, body) => ({ id: `sk_${title}`, title, tendency: 'custom', body, updatedAt: 1 });
  return {
    byId, storageSets, sandbox,
    api: sandbox.window.PopupPageAdvisorSkills,
    skill,
    lastSet: () => storageSets[storageSets.length - 1] || null,
  };
}

describe('Popup 提示词 Skill：列表渲染与保存门闩（OPT-20260922-002）', () => {
  let ctx;

  beforeEach(() => { ctx = bootPopup(); });

  it('DOM mock 覆盖 popup-prompt-skills.js 引用的全部 id，且 popup.html 确有这些元素', () => {
    const referenced = new Set();
    const re = /\$\('#([A-Za-z0-9_-]+)'\)/g;
    let m;
    while ((m = re.exec(popupSkillsSrc))) referenced.add(m[1]);
    assert.ok(referenced.size > 0, '未解析到任何 #id 选择器');
    for (const id of referenced) {
      assert.ok(SKILL_IDS.includes(id), `用例未 mock 的 id：${id}`);
      assert.ok(popupHtml.includes(`id="${id}"`), `popup.html 缺少 id="${id}"`);
    }
  });

  it('保存后列表出现新 Skill 的 radio 并被选中，落盘写入 activeSkillId', async () => {
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(ctx.byId.popupSkillList.children.length, 0, '初始无 Skill 应渲染空列表');

    ctx.byId.popupSkillTitle.value = '严谨排障';
    ctx.byId.popupSkillBody.value = '先复现再下结论';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    const rows = ctx.byId.popupSkillList.children;
    assert.equal(rows.length, 1, '保存后列表应有一行');
    const radio = rows[0].children[0];
    const text = rows[0].children[1];
    assert.equal(radio.type, 'radio');
    assert.equal(radio.name, 'popupSkillActive');
    assert.match(text.textContent, /严谨排障/);
    assert.equal(radio.checked, true, '首个 Skill 自动成为 active');
    assert.equal(ctx.byId.popupSkillEditingId.value, radio.value, '保存后应进入编辑该 Skill');

    const written = ctx.lastSet();
    assert.equal(written.pageAdvisorActiveSkillId, radio.value);
    assert.equal(written.pageAdvisorPromptSkills.length, 1);
    assert.equal(written.pageAdvisorPromptSkills[0].title, '严谨排障');
  });

  it('切换 active radio 后 saveToStorage 写入新 pageAdvisorActiveSkillId', async () => {
    ctx = bootPopup({
      skills: [ctx.skill('甲', 'a'), ctx.skill('乙', 'b')],
      activeSkillId: 'sk_甲',
    });
    ctx.api.loadSkills();
    await flushAll();

    const rows = ctx.byId.popupSkillList.children;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].children[0].checked, true, '初始 active 为第一个');
    const second = rows[1].children[0];
    second.checked = true;
    second.dispatch('change', { target: second });
    await flushAll();

    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, second.value);
    assert.equal(ctx.byId.popupSkillList.children[1].children[0].checked, true, '重渲染后第二个为 active');
    assert.equal(ctx.byId.popupSkillList.children[0].children[0].checked, false);
  });

  it('保存失败（storage 不可用）不吞错：状态文本给出提示且不抛未捕获异常', async () => {
    const original = ctx.sandbox.Storage;
    ctx.sandbox.Storage = { get: async () => ({}), set: async () => { throw new Error('storage unavailable'); } };
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.popupSkillTitle.value = '会失败';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    assert.match(ctx.byId.popupSkillStatus.textContent, /会失败|保存|storage unavailable/);
    ctx.sandbox.Storage = original;
  });
});
