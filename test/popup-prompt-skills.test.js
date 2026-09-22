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
const popupSkillUiSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skill-ui.js'), 'utf8');
const popupSkillsSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skills.js'), 'utf8');

/** 被测脚本用到的 popup.html 元素 id。 */
const SKILL_IDS = [
  'pageAdvisorSkillSection',
  'popupSkillConflict',
  'btnSkillConflictKeepLocal',
  'btnSkillConflictUseCloud',
  'btnSkillHistoryLoad',
  'popupSkillRevisions',
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
  for (let i = 0; i < 5; i += 1) await flush();
}

/**
 * 装配沙箱：真实 lib（i18n + PageAdvisorPromptSkills）+ 真实 popup-prompt-skills.js。
 * 不注入 PageAdvisorAPI —— 云端同步/推送按 `typeof` 短路，用例只验本机绑定与落盘。
 */
function bootPopup({ skills = [], activeSkillId = '', api = null } = {}) {
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
  if (api) sandbox.PageAdvisorAPI = api;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  installTxInSandbox(sandbox);
  vm.runInContext(skillsRuntimeSrc, sandbox, { filename: 'lib/page-advisor-prompt-skills.js' });
  vm.runInContext(popupSkillUiSrc, sandbox, { filename: 'popup/popup-prompt-skill-ui.js' });
  vm.runInContext(popupSkillsSrc, sandbox, { filename: 'popup/popup-prompt-skills.js' });
  if (api && sandbox.PopupPageAdvisorSkills) {
    sandbox.PopupPageAdvisorSkills.scopeProvider = async () => ({ tenantId: 't1', workspaceId: 'w1' });
    if (byId.popupDefaultWorkspace) byId.popupDefaultWorkspace.value = 'w1';
  }

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

  it('保存携带 GET 回传的 revision 作为 base_revision（CAS 接线）', async () => {
    const puts = [];
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({
          skills: [{ id: 'sk_cloud', title: '云端', tendency: 'custom', body: 'x', updated_at: 5 }],
          active_skill_id: 'sk_cloud',
          revision: 'rev-1',
        }),
        putPromptSkills: async (_tid, _wid, payload) => { puts.push(payload); return { revision: 'rev-2' }; },
      },
    });
    ctx.api.loadSkills();
    await flushAll();

    ctx.byId.popupSkillTitle.value = '云端改';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    assert.equal(puts.length, 1, '应推送一次');
    assert.equal(puts[0].base_revision, 'rev-1');
  });

  it('409 冲突：显示二选一面板，且不覆盖云端也不丢本机', async () => {
    const puts = [];
    const cloudBundle = {
      skills: [{ id: 'sk_cloud', title: '另一台的', tendency: 'custom', body: 'y', updated_at: 7 }],
      active_skill_id: 'sk_cloud',
      revision: 'rev-cloud',
    };
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({
          skills: [], active_skill_id: '', revision: 'rev-empty',
        }),
        putPromptSkills: async (_tid, _wid, payload) => {
          puts.push(payload);
          const err = new Error('conflict');
          err.status = 409;
          err.body = { current: cloudBundle };
          throw err;
        },
      },
    });
    ctx.api.loadSkills();
    await flushAll();

    ctx.byId.popupSkillTitle.value = '本机的';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    assert.equal(ctx.byId.popupSkillConflict.style.display, 'block', '冲突面板应显示');
    assert.equal(puts[0].base_revision, 'rev-empty', '首次 PUT 用 GET 的 revision');
    // 本机内容仍已落本机。
    assert.equal(ctx.lastSet().pageAdvisorPromptSkills[0].title, '本机的');

    // 选择「使用云端」→ 采纳云端文档并落本机、关闭面板。
    ctx.byId.btnSkillConflictUseCloud.dispatch('click');
    await flushAll();
    assert.equal(ctx.byId.popupSkillConflict.style.display, 'none', '选择后面板关闭');
    const after = ctx.lastSet();
    assert.equal(after.pageAdvisorPromptSkills[0].title, '另一台的');
    assert.equal(after.pageAdvisorActiveSkillId, 'sk_cloud');
    assert.equal(puts.length, 1, '采纳云端不应再 PUT');
  });

  it('409 冲突选「保留本机」：重试 PUT 不带 base_revision 覆盖云端', async () => {
    const puts = [];
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'rev-empty' }),
        putPromptSkills: async (_tid, _wid, payload) => {
          puts.push(payload);
          if (puts.length === 1) {
            const err = new Error('conflict');
            err.status = 409;
            err.body = { current: { skills: [], active_skill_id: '', revision: 'rev-cloud' } };
            throw err;
          }
          return { revision: 'rev-forced' };
        },
      },
    });
    ctx.api.loadSkills();
    await flushAll();

    ctx.byId.popupSkillTitle.value = '本机的';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    assert.equal(ctx.byId.popupSkillConflict.style.display, 'block');

    ctx.byId.btnSkillConflictKeepLocal.dispatch('click');
    await flushAll();

    assert.equal(puts.length, 2, '应重试一次');
    assert.equal('base_revision' in puts[1], false, '用户确认覆盖后不带 base_revision');
    assert.equal(puts[1].skills[0].title, '本机的');
    assert.equal(ctx.byId.popupSkillConflict.style.display, 'none', '成功后关闭面板');
  });

  it('修订列表：当前版本不可点，历史版本可回滚（OPT-20260922-004）', async () => {
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'rev-now' }),
        listPromptSkillRevisions: async () => ([
          { revision: 'rev-now', skill_count: 1, actor_user_id: 'u1', created_at: '2026-09-22T00:00:00Z' },
          { revision: 'rev-old', skill_count: 1, actor_user_id: 'u2', created_at: '2026-09-21T00:00:00Z' },
        ]),
      },
    });
    ctx.api.loadSkills();
    await flushAll();

    ctx.byId.btnSkillHistoryLoad.dispatch('click');
    await flushAll();

    const rows = ctx.byId.popupSkillRevisions.children;
    assert.equal(rows.length, 2, '两条修订应各渲染一行');
    assert.match(rows[0].children[0].textContent, /rev-now/, '展示版本号摘要');
    assert.equal(rows[0].children[1].disabled, true, '当前版本不应可回滚');
    assert.equal(rows[1].children[1].disabled, false, '历史版本应可回滚');
  });

  it('回滚：带 base_revision 调用 restore，并采纳返回的正文', async () => {
    const calls = [];
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'rev-now' }),
        listPromptSkillRevisions: async () => ([
          { revision: 'rev-old', skill_count: 1, actor_user_id: 'u2', created_at: '2026-09-21T00:00:00Z' },
        ]),
        restorePromptSkillRevision: async (_tid, _wid, revision, baseRevision, ik) => {
          calls.push({ revision, baseRevision, ik });
          return {
            skills: [{ id: 'sk_old', title: '上一版', tendency: 'custom', body: 'b', updated_at: 3 }],
            active_skill_id: 'sk_old',
            revision: 'rev-old',
          };
        },
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.btnSkillHistoryLoad.dispatch('click');
    await flushAll();

    const btn = ctx.byId.popupSkillRevisions.children[0].children[1];
    btn.dispatch('click');
    await flushAll();

    assert.equal(calls.length, 1, '应调用一次回滚');
    assert.equal(calls[0].revision, 'rev-old');
    assert.equal(calls[0].baseRevision, 'rev-now', '回滚须带本机看到的云端版本做 CAS');
    assert.ok(String(calls[0].ik || '').trim(), '回滚须带幂等键');
    // 正文被采纳并落本机。
    assert.equal(ctx.lastSet().pageAdvisorPromptSkills[0].title, '上一版');
    assert.match(ctx.byId.popupSkillStatus.textContent, /回滚|Restored/);
  });

  it('回滚撞上并发编辑（409）走冲突二选一面板，不静默覆盖', async () => {
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'rev-now' }),
        listPromptSkillRevisions: async () => ([
          { revision: 'rev-old', skill_count: 1, actor_user_id: 'u2', created_at: '2026-09-21T00:00:00Z' },
        ]),
        restorePromptSkillRevision: async () => {
          const err = new Error('conflict');
          err.status = 409;
          err.body = { current: { skills: [], active_skill_id: '', revision: 'rev-other' } };
          throw err;
        },
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.btnSkillHistoryLoad.dispatch('click');
    await flushAll();
    ctx.byId.popupSkillRevisions.children[0].children[1].dispatch('click');
    await flushAll();

    assert.equal(ctx.byId.popupSkillConflict.style.display, 'block', '409 应显示二选一面板');
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

describe('Popup 提示词 Skill：采纳服务端合并结果（OPT-20260922-005）', () => {
  let ctx;

  const cloudOriginal = {
    skills: [
      { id: 'sk_seo', title: 'SEO 原文', tendency: 'seo', body: 'meta', updated_at: 1 },
      { id: 'sk_conv', title: '转化 原文', tendency: 'conversion', body: 'cta', updated_at: 1 },
    ],
    active_skill_id: 'sk_seo',
    revision: 'rev-1',
  };
  // 服务端把本机改的「转化」与自己改的「SEO」按 skill_id 合并后落库再回传。
  const merged = {
    skills: [
      { id: 'sk_seo', title: 'SEO 同事改的', tendency: 'seo', body: 'meta', updated_at: 1 },
      { id: 'sk_conv', title: '转化 本机改的', tendency: 'conversion', body: 'cta', updated_at: 1 },
    ],
    active_skill_id: 'sk_seo',
    revision: 'rev-merged',
  };

  function bootMergingPopup() {
    const puts = [];
    const c = bootPopup({
      api: {
        getPromptSkills: async () => cloudOriginal,
        putPromptSkills: async (_t, _w, payload) => { puts.push(payload); return merged; },
      },
    });
    return { c, puts };
  }

  it('PUT 回传合并后的正文时本机采纳，下次保存不会把同事那半边改回去', async () => {
    const { c, puts } = bootMergingPopup();
    ctx = c;
    ctx.api.loadSkills();
    await flushAll();

    ctx.byId.popupSkillEditingId.value = 'sk_conv';
    ctx.byId.popupSkillTitle.value = '转化 本机改的';
    ctx.byId.popupSkillTendency.value = 'conversion';
    ctx.byId.popupSkillBody.value = 'cta';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    assert.equal(puts.length, 1, '应推送一次');
    assert.equal(puts[0].base_revision, 'rev-1');

    // 落盘必须是合并后的正文：本机改动与同事改动都在。
    const written = ctx.lastSet().pageAdvisorPromptSkills;
    assert.equal(written.find((s) => s.id === 'sk_conv').title, '转化 本机改的');
    assert.equal(
      written.find((s) => s.id === 'sk_seo').title,
      'SEO 同事改的',
      '合并进来的同事改动必须落到本机，否则下次保存会把它当成「本机改动」改回去',
    );
    assert.equal(ctx.byId.popupSkillTitle.value, '转化 本机改的', '编辑器应显示落库正文');

    // 再存一次：带的是合并后的正文与合并后的 revision，不会回退同事的改动。
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    assert.equal(puts.length, 2);
    assert.equal(puts[1].base_revision, 'rev-merged');
    assert.equal(puts[1].skills.find((s) => s.id === 'sk_seo').title, 'SEO 同事改的');
  });

  it('PUT 回传内容与本机一致时不重复落盘', async () => {
    // 没有并发编辑时服务端原样落库：回传的正文 = 刚提交的那份（只换 revision）。
    const echoed = [];
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => cloudOriginal,
        putPromptSkills: async (_t, _w, payload) => {
          echoed.push(payload);
          return { ...payload, revision: 'rev-2' };
        },
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    const setsBefore = ctx.storageSets.length;

    ctx.byId.popupSkillTitle.value = 'SEO 改了下';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    assert.equal(echoed.length, 1);
    assert.equal(
      ctx.storageSets.length,
      setsBefore + 1,
      '正文没被服务端改写时不该多落一次盘',
    );
    assert.equal(ctx.byId.popupSkillTitle.value, 'SEO 改了下');
  });
});
