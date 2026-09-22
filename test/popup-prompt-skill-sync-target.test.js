'use strict';

/**
 * Popup Skill：设置折叠点击展开；每条可选本机或指定工作空间（PUT 按 wid 分流）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { installTxInSandbox } = require('./helpers/txRuntime.js');

const llmUiSrc = fs.readFileSync(path.join(ROOT, 'lib/popup-llm-settings-ui.js'), 'utf8');
const skillsRuntimeSrc = fs.readFileSync(path.join(ROOT, 'lib/page-advisor-prompt-skills.js'), 'utf8');
const popupSkillUiSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skill-ui.js'), 'utf8');
const popupSkillsSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skills.js'), 'utf8');

const SKILL_IDS = [
  'pageAdvisorSkillSection',
  'popupSkillConflict',
  'btnSkillConflictKeepLocal',
  'btnSkillConflictUseCloud',
  'popupSkillList',
  'popupSkillEditor',
  'popupSkillEditingId',
  'popupSkillTitle',
  'popupSkillTendency',
  'popupSkillBody',
  'popupSkillStatus',
  'btnSkillNew',
  'btnSkillSave',
  'btnSkillClearActive',
  'btnToggleSkillSettings',
  'pageAdvisorSkillFields',
  'popupSkillSyncTarget',
  'popupSkillActiveSummary',
  'popupDefaultWorkspace',
];

function makeEl(tag, id) {
  const handlers = Object.create(null);
  const attrs = Object.create(null);
  let text = '';
  return {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    children: [],
    style: (id === 'pageAdvisorSkillFields' || id === 'popupSkillEditor') ? { display: 'none' } : {},
    hidden: id === 'pageAdvisorSkillFields' || id === 'popupSkillEditor',
    className: '',
    value: '',
    checked: false,
    disabled: false,
    get textContent() { return text; },
    set textContent(v) { text = String(v); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type, ev) { (handlers[type] || []).forEach((fn) => fn(ev || {})); },
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    options: [],
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    set innerHTML(html) {
      const values = [...String(html).matchAll(/value="([^"]*)"/g)].map((x) => x[1]);
      this.options = values.map((value) => ({ value }));
      this._innerHTML = String(html);
    },
    get innerHTML() { return this._innerHTML || ''; },
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function flushAll() {
  for (let i = 0; i < 8; i += 1) await flush();
}

function bootPopup({ api = null } = {}) {
  const byId = Object.create(null);
  SKILL_IDS.forEach((id) => { byId[id] = makeEl(id.startsWith('btn') ? 'button' : 'div', id); });
  byId.btnToggleSkillSettings.setAttribute('aria-expanded', 'false');
  const storageSets = [];
  const puts = [];
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
    Storage: {
      get: async () => ({ pageAdvisorPromptSkills: [], pageAdvisorActiveSkillId: '' }),
      set: async (obj) => { storageSets.push(obj); },
    },
    sendMessageWithTimeout: async (msg) => {
      if (msg?.action === 'getWorkspaces') {
        return {
          data: [
            { id: 'w1', name: '默认空间', company_id: 't1' },
            { id: 'w2', name: '另一空间', company_id: 't1' },
          ],
        };
      }
      return { success: true };
    },
  };
  sandbox.PageAdvisorAPI = api || {
    getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'rev-empty' }),
    putPromptSkills: async (_tid, wid, payload) => {
      puts.push({ wid, payload });
      return { revision: `rev-${wid}-2`, skills: payload.skills, active_skill_id: payload.active_skill_id };
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  installTxInSandbox(sandbox);
  vm.runInContext(llmUiSrc, sandbox, { filename: 'lib/popup-llm-settings-ui.js' });
  vm.runInContext(skillsRuntimeSrc, sandbox, { filename: 'lib/page-advisor-prompt-skills.js' });
  vm.runInContext(popupSkillUiSrc, sandbox, { filename: 'popup/popup-prompt-skill-ui.js' });
  vm.runInContext(popupSkillsSrc, sandbox, { filename: 'popup/popup-prompt-skills.js' });
  sandbox.PopupPageAdvisorSkills.scopeProvider = async () => ({ tenantId: 't1', workspaceId: 'w1' });
  byId.popupDefaultWorkspace.value = 'w1';
  return { byId, storageSets, puts, api: sandbox.PopupPageAdvisorSkills };
}

describe('Popup Skill 设置展开与按条同步目标', () => {
  it('点击设置按钮展开管理区，再点收起', async () => {
    const ctx = bootPopup();
    ctx.api.loadSkills();
    await flushAll();
    const fields = ctx.byId.pageAdvisorSkillFields;
    const btn = ctx.byId.btnToggleSkillSettings;
    assert.equal(fields.style.display, 'none');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    btn.dispatch('click');
    assert.equal(fields.style.display, 'block');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    btn.dispatch('click');
    assert.equal(fields.style.display, 'none');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
  });

  it('存储下拉含本机与各工作空间', async () => {
    const ctx = bootPopup();
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.btnSkillNew.dispatch('click');
    const values = ctx.byId.popupSkillSyncTarget.options.map((o) => o.value);
    assert.ok(values.includes('local'));
    assert.ok(values.includes('w1'));
    assert.ok(values.includes('w2'));
  });

  it('选本机保存：PUT 到默认空间的包不含该 Skill', async () => {
    const ctx = bootPopup();
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.popupSkillTitle.value = '仅本机';
    ctx.byId.popupSkillBody.value = 'secret-local';
    ctx.byId.popupSkillSyncTarget.value = 'local';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    assert.equal(ctx.storageSets.at(-1).pageAdvisorPromptSkills[0].syncTarget, 'local');
    const w1Puts = ctx.puts.filter((p) => p.wid === 'w1');
    assert.ok(w1Puts.length >= 1, '应对默认空间做 GET-merge PUT');
    const lastW1 = w1Puts[w1Puts.length - 1];
    assert.equal(
      lastW1.payload.skills.some((s) => s.title === '仅本机'),
      false,
      '本机 Skill 不得写入工作空间包',
    );
  });

  it('选工作空间 w2 保存：PUT 打到 w2 且含该 Skill', async () => {
    const ctx = bootPopup();
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.popupSkillTitle.value = '给B空间';
    ctx.byId.popupSkillBody.value = 'shared';
    ctx.byId.popupSkillSyncTarget.value = 'w2';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    assert.equal(ctx.storageSets.at(-1).pageAdvisorPromptSkills[0].syncTarget, 'w2');
    const w2Puts = ctx.puts.filter((p) => p.wid === 'w2');
    assert.equal(w2Puts.length, 1);
    assert.equal(w2Puts[0].payload.skills[0].title, '给B空间');
  });

  it('列表每行有存储下拉，改目标会 persist', async () => {
    const ctx = bootPopup();
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.popupSkillTitle.value = '可改目标';
    ctx.byId.popupSkillBody.value = 'x';
    ctx.byId.popupSkillSyncTarget.value = 'local';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    const row = ctx.byId.popupSkillList.children[0];
    const dest = row.children[2];
    assert.equal(dest.tagName, 'SELECT');
    dest.value = 'w2';
    dest.dispatch('change', { stopPropagation() {} });
    await flushAll();
    assert.equal(ctx.storageSets.at(-1).pageAdvisorPromptSkills[0].syncTarget, 'w2');
    assert.ok(ctx.puts.some((p) => p.wid === 'w2' && p.payload.skills.some((s) => s.title === '可改目标')));
  });

  it('加载后编辑区隐藏；点新建才展开；点编辑展开；条目后可删除', async () => {
    const ctx = bootPopup();
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(ctx.byId.popupSkillEditor.style.display, 'none');
    ctx.byId.btnSkillNew.dispatch('click');
    assert.equal(ctx.byId.popupSkillEditor.style.display, 'block');
    ctx.byId.popupSkillTitle.value = '待删';
    ctx.byId.popupSkillBody.value = 'x';
    ctx.byId.popupSkillSyncTarget.value = 'local';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    assert.equal(ctx.byId.popupSkillEditor.style.display, 'none');
    const row = ctx.byId.popupSkillList.children[0];
    assert.equal(row.children[3].textContent, '编辑');
    assert.equal(row.children[4].textContent, '删除');
    row.children[3].dispatch('click', { stopPropagation() {} });
    assert.equal(ctx.byId.popupSkillEditor.style.display, 'block');
    assert.equal(ctx.byId.popupSkillTitle.value, '待删');
    row.children[4].dispatch('click', { stopPropagation() {} });
    await flushAll();
    assert.equal(ctx.byId.popupSkillList.children.length, 0);
  });
});
