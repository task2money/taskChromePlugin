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
const {
  skillRows,
  noneRow,
  skillRow,
  skillRowByTitle,
  rowRadio,
  rowTitle,
  rowActions,
  groupEls,
  categoryPicks,
  openCategory,
  backToCategories,
} = require('./helpers/popupSkillListDom.js');

const popupHtml = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
const skillsPresetSrc = fs.readFileSync(path.join(ROOT, 'lib/page-advisor-preset-skills.js'), 'utf8');
const skillsRuntimeSrc = fs.readFileSync(path.join(ROOT, 'lib/page-advisor-prompt-skills.js'), 'utf8');
const popupSkillUiSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skill-ui.js'), 'utf8');
const popupSkillSessionSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skill-session.js'), 'utf8');
const popupSkillCloudSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skill-cloud.js'), 'utf8');
const popupSkillsSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-prompt-skills.js'), 'utf8');
const popupAuthSrc = fs.readFileSync(path.join(ROOT, 'popup/popup-auth.js'), 'utf8');

/** 被测脚本用到的 popup.html 元素 id。 */
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
  'popupSkillTendencyList',
  'popupSkillBody',
  'popupSkillStatus',
  'btnSkillNew',
  'btnSkillSave',
  'popupSkillDeleteConfirm',
  'popupSkillDeleteConfirmMsg',
  'btnSkillDeleteCancel',
  'btnSkillDeleteConfirm',
  'btnToggleSkillSettings',
  'pageAdvisorSkillFields',
  'popupSkillSyncTarget',
  'popupSkillActiveSummary',
  // 未登录时登录表单保持收起：setLoginFormExpanded 读写这两个元素
  'loginSection',
  'btnToggleLogin',
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
    open: false,
    hidden: false,
    showModal() { this.open = true; this.style.display = 'block'; this.hidden = false; },
    close() { this.open = false; this.style.display = 'none'; this.hidden = true; },
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
function bootPopup({
  skills = [],
  activeSkillId = '',
  api = null,
  loggedIn = !!api,
  omitLoggedInProvider = false,
  withAuth = false,
} = {}) {
  const byId = Object.create(null);
  SKILL_IDS.forEach((id) => { byId[id] = makeEl(id.startsWith('btn') ? 'button' : 'div', id); });
  const storageSets = [];
  const storage = {
    get: async () => ({ pageAdvisorPromptSkills: skills, pageAdvisorActiveSkillId: activeSkillId }),
    set: async (obj) => { storageSets.push(obj); },
    getLastWorkspace: async () => (api ? 'w1' : ''),
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
  vm.runInContext(skillsPresetSrc, sandbox, { filename: 'lib/page-advisor-preset-skills.js' });
  vm.runInContext(skillsRuntimeSrc, sandbox, { filename: 'lib/page-advisor-prompt-skills.js' });
  vm.runInContext(popupSkillUiSrc, sandbox, { filename: 'popup/popup-prompt-skill-ui.js' });
  vm.runInContext(popupSkillSessionSrc, sandbox, { filename: 'popup/popup-prompt-skill-session.js' });
  vm.runInContext(popupSkillCloudSrc, sandbox, { filename: 'popup/popup-prompt-skill-cloud.js' });
  if (sandbox.PopupPromptSkillSession && !omitLoggedInProvider) {
    sandbox.PopupPromptSkillSession.loggedInProvider = async () => loggedIn;
  }
  vm.runInContext(popupSkillsSrc, sandbox, { filename: 'popup/popup-prompt-skills.js' });
  // popup-auth.js 与 Popup 同构地共享 var/function 全局；装载后 setLoginFormExpanded 才可解析
  if (withAuth) vm.runInContext(popupAuthSrc, sandbox, { filename: 'popup/popup-auth.js' });
  if (sandbox.PopupPageAdvisorSkills) {
    if (!omitLoggedInProvider) {
      sandbox.PopupPageAdvisorSkills.loggedInProvider = async () => loggedIn;
    }
    if (api) {
      sandbox.PopupPageAdvisorSkills.scopeProvider = async () => ({ tenantId: 't1', workspaceId: 'w1' });
      sandbox.PopupPageAdvisorSkills.sessionProvider = async () => ({
        baseUrl: 'https://saas.example',
        token: 'tok',
      });
    }
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
    assert.equal(categoryPicks(ctx.byId.popupSkillList).length, 5);
    assert.equal(skillRows(ctx.byId.popupSkillList).length, 0, '未选类别前不展示技能');

    ctx.byId.popupSkillTitle.value = '严谨排障';
    ctx.byId.popupSkillBody.value = '先复现再下结论';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    const list = ctx.byId.popupSkillList;
    openCategory(list, 'custom');
    const custom = skillRowByTitle(list, /严谨排障/);
    const radio = rowRadio(custom);
    assert.equal(radio.type, 'radio');
    assert.equal(radio.name, 'popupSkillActive');
    assert.match(rowTitle(custom).textContent, /严谨排障/);
    assert.equal(rowRadio(skillRowByTitle(list, /系统默认自动创新/)).checked, true, '预埋 custom 默认仍为 active');
    assert.equal(radio.checked, false);
    assert.equal(rowRadio(noneRow(list)).checked, false);

    const written = ctx.lastSet();
    assert.equal(written.pageAdvisorActiveSkillId, 'sys_default_auto_innovate');
    assert.equal(written.pageAdvisorPromptSkills.filter((s) => s.title === '严谨排障').length, 1);
    assert.equal(written.pageAdvisorPromptSkills.length, 6);
  });

  it('切换 active radio 后 saveToStorage 写入新 pageAdvisorActiveSkillId', async () => {
    ctx = bootPopup({
      skills: [ctx.skill('甲', 'a'), ctx.skill('乙', 'b')],
      activeSkillId: 'sk_甲',
    });
    ctx.api.loadSkills();
    await flushAll();

    const list = ctx.byId.popupSkillList;
    openCategory(list, 'custom');
    assert.equal(rowRadio(skillRowByTitle(list, /甲/)).checked, true, '初始 active 为甲');
    const second = rowRadio(skillRowByTitle(list, /乙/));
    second.checked = true;
    second.dispatch('change', { target: second });
    await flushAll();

    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, second.value);
    assert.equal(rowRadio(skillRowByTitle(ctx.byId.popupSkillList, /乙/)).checked, true, '重渲染后乙为 active');
    assert.equal(rowRadio(skillRowByTitle(ctx.byId.popupSkillList, /甲/)).checked, false);
    assert.equal(rowRadio(noneRow(ctx.byId.popupSkillList)).checked, false);
  });

  it('勾选「不应用」后落盘 activeSkillId 为空', async () => {
    ctx = bootPopup({
      skills: [ctx.skill('甲', 'a')],
      activeSkillId: 'sk_甲',
    });
    ctx.api.loadSkills();
    await flushAll();
    const none = rowRadio(noneRow(ctx.byId.popupSkillList));
    none.checked = true;
    none.dispatch('change', { target: none });
    await flushAll();
    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, '');
    assert.equal(rowRadio(noneRow(ctx.byId.popupSkillList)).checked, true);
  });

  it('Delete 先弹出确认；取消不删；确认后才删除', async () => {
    ctx = bootPopup({
      skills: [ctx.skill('待删', 'x')],
      activeSkillId: 'sk_待删',
    });
    ctx.api.loadSkills();
    await flushAll();
    openCategory(ctx.byId.popupSkillList, 'custom');
    const del = rowActions(skillRowByTitle(ctx.byId.popupSkillList, /待删/)).children[2];
    del.dispatch('click', { stopPropagation() {} });
    await flushAll();
    assert.equal(ctx.byId.popupSkillDeleteConfirm.open, true);
    assert.match(ctx.byId.popupSkillDeleteConfirmMsg.textContent, /待删/);
    assert.ok(skillRowByTitle(ctx.byId.popupSkillList, /待删/), '未确认前仍保留 Skill');
    ctx.byId.btnSkillDeleteCancel.dispatch('click');
    await flushAll();
    assert.equal(ctx.byId.popupSkillDeleteConfirm.open, false);
    assert.ok(skillRowByTitle(ctx.byId.popupSkillList, /待删/));

    rowActions(skillRowByTitle(ctx.byId.popupSkillList, /待删/)).children[2].dispatch('click', { stopPropagation() {} });
    ctx.byId.btnSkillDeleteConfirm.dispatch('click');
    await flushAll();
    assert.equal(skillRowByTitle(ctx.byId.popupSkillList, /待删/), undefined);
    assert.equal(ctx.lastSet().pageAdvisorPromptSkills.some((s) => s.title === '待删'), false);
    assert.equal(ctx.lastSet().pageAdvisorPromptSkills.length, 5);
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
    assert.equal(
      ctx.lastSet().pageAdvisorPromptSkills.find((s) => s.title === '本机的').title,
      '本机的',
    );

    // 选择「使用云端」→ 采纳云端文档并落本机、关闭面板。
    ctx.byId.btnSkillConflictUseCloud.dispatch('click');
    await flushAll();
    assert.equal(ctx.byId.popupSkillConflict.style.display, 'none', '选择后面板关闭');
    const after = ctx.lastSet();
    assert.equal(after.pageAdvisorPromptSkills.find((s) => s.title === '另一台的').title, '另一台的');
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

  it('未登录保存只落本机：不发任何云请求（OPT-20260922-039 守卫）', async () => {
    const puts = [];
    const gets = [];
    const api = {
      getPromptSkills: async (...a) => { gets.push(a); return { skills: [], revision: 'r1' }; },
      putPromptSkills: async (...a) => { puts.push(a); return {}; },
    };
    ctx = bootPopup({ api, loggedIn: false });
    await ctx.api.loadSkills();
    ctx.byId.popupSkillTitle.value = '仅本机';
    ctx.byId.popupSkillBody.value = 'x';
    ctx.byId.popupSkillSyncTarget.value = 'w1';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    assert.equal(puts.length, 0, '未登录不得 PUT');
    assert.equal(gets.length, 0, '未登录不得拉取工作空间 Skill');
    assert.equal(ctx.lastSet().pageAdvisorPromptSkills.some((sk) => sk.title === '仅本机'), true);
  });

  it('未登录 loadSkills 后登录表单保持收起，顶栏登录按钮仍在', async () => {
    ctx = bootPopup({ withAuth: true });
    ctx.byId.loginSection.style.display = 'none';
    ctx.byId.btnToggleLogin.setAttribute('aria-expanded', 'false');
    ctx.byId.btnToggleLogin.textContent = '登录';
    await ctx.api.loadSkills();
    await flushAll();

    assert.equal(ctx.byId.loginSection.style.display, 'none', '未登录默认收起 #loginSection');
    assert.equal(ctx.byId.btnToggleLogin.getAttribute('aria-expanded'), 'false');
    assert.equal(ctx.byId.btnToggleLogin.textContent, '登录');
    assert.match(ctx.byId.popupSkillStatus.textContent, /本机|device|登录|Sign/i);
  });

  it('已登录时不误展开登录表单（OPT-20260922-040）', async () => {
    const api = {
      getPromptSkills: async () => ({ skills: [], revision: 1 }),
      getSystemPromptSkills: async () => ({ skills: [] }),
      putPromptSkills: async () => ({}),
    };
    ctx = bootPopup({ api, withAuth: true });
    ctx.byId.loginSection.style.display = 'none';
    await ctx.api.loadSkills();
    await flushAll();

    assert.equal(ctx.byId.loginSection.style.display, 'none', '已登录不得展开登录表单');
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
    assert.ok(
      ctx.storageSets.length >= setsBefore + 1
      && ctx.storageSets.length <= setsBefore + 2,
      `正文没被服务端改写时至多再落一次盘（echo 剥离系统 id），实际 ${ctx.storageSets.length - setsBefore}`,
    );
    assert.equal(ctx.byId.popupSkillTitle.value, 'SEO 改了下');
  });

  it('T5 未登录不拉取工作空间 Skill', async () => {
    const gets = [];
    const catalogs = [];
    ctx = bootPopup({
      loggedIn: false,
      api: {
        getPromptSkills: async () => { gets.push(1); return { skills: [], active_skill_id: '', revision: 'x' }; },
        putPromptSkills: async () => ({ revision: 'y', skills: [], active_skill_id: '' }),
        getSystemPromptSkills: async () => { catalogs.push(1); return { skills: [] }; },
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(gets.length, 0);
    assert.equal(catalogs.length, 0);
    assert.match(ctx.byId.popupSkillStatus.textContent, /未登录|Signed out/);
    assert.equal(categoryPicks(ctx.byId.popupSkillList).length, 5);
    assert.equal(skillRows(ctx.byId.popupSkillList).length, 0, '未选类别前不展示预埋技能');
    openCategory(ctx.byId.popupSkillList, 'a11y');
    assert.ok(skillRowByTitle(ctx.byId.popupSkillList, /系统默认·无障碍/));
    backToCategories(ctx.byId.popupSkillList);
    openCategory(ctx.byId.popupSkillList, 'custom');
    assert.ok(skillRowByTitle(ctx.byId.popupSkillList, /系统默认自动创新/));
  });

  it('登录后拉取管理员新空间默认并选中', async () => {
    const catalogs = [];
    ctx = bootPopup({
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'empty' }),
        putPromptSkills: async () => ({ revision: 'y' }),
        getSystemPromptSkills: async () => {
          catalogs.push(1);
          return {
            skills: [{
              id: 'sys_default_auto_innovate',
              title: '系统默认自动创新',
              tendency: 'custom',
              body: '平台提示',
              is_default: true,
            }],
          };
        },
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(catalogs.length, 1);
    const list = ctx.byId.popupSkillList;
    assert.equal(categoryPicks(list).length, 5);
    assert.equal(skillRows(list).length, 0);
    openCategory(list, 'a11y');
    assert.ok(skillRowByTitle(list, /系统默认·无障碍/));
    backToCategories(list);
    openCategory(list, 'custom');
    const custom = skillRowByTitle(list, /系统默认自动创新/);
    assert.match(rowTitle(custom).textContent, /系统默认自动创新/);
    assert.equal(rowRadio(custom).checked, true);
    assert.equal(rowRadio(noneRow(list)).checked, false);
    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, 'sys_default_auto_innovate');
  });

  it('T10 sessionOverride 不依赖 Popup 内存 API token', async () => {
    const seen = [];
    ctx = bootPopup({
      api: {
        getPromptSkills: async (_t, _w, session) => {
          seen.push(['ws', session]);
          return { skills: [], active_skill_id: '', revision: 'empty' };
        },
        getSystemPromptSkills: async (session) => {
          seen.push(['cat', session]);
          return {
            skills: [{
              id: 'sys_default_auto_innovate',
              title: '系统默认自动创新',
              body: '平台提示',
              is_default: true,
            }],
          };
        },
      },
    });
    ctx.sandbox.API = { getBaseUrl: () => '', getToken: () => '' };
    ctx.api.sessionProvider = async () => ({ baseUrl: 'https://saas.example', token: 'override-tok' });
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(seen[seen.length - 1][0], 'cat');
    assert.equal(seen[seen.length - 1][1].baseUrl, 'https://saas.example');
    assert.equal(seen[seen.length - 1][1].token, 'override-tok');
    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, 'sys_default_auto_innovate');
  });

  it('getAuthStatus 失败时仍用 sessionProvider 拉系统默认 Skill', async () => {
    const catalogs = [];
    ctx = bootPopup({
      omitLoggedInProvider: true,
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'empty' }),
        getSystemPromptSkills: async () => {
          catalogs.push(1);
          return {
            skills: [{
              id: 'sys_default_auto_innovate',
              title: '系统默认自动创新',
              body: '平台提示',
              is_default: true,
            }],
          };
        },
      },
    });
    ctx.sandbox.sendMessageWithTimeout = async () => { throw new Error('sw down'); };
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(catalogs.length, 1);
    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, 'sys_default_auto_innovate');
    assert.doesNotMatch(ctx.byId.popupSkillStatus.textContent, /未登录|Signed out/);
  });

  it('本机已有目录 default 且不应用时不覆盖', async () => {
    ctx = bootPopup({
      skills: [{
        id: 'sys_default_auto_innovate',
        title: '系统默认自动创新',
        tendency: 'custom',
        body: 'old',
        updatedAt: 1,
        syncTarget: 'local',
      }],
      activeSkillId: '',
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'empty' }),
        getSystemPromptSkills: async () => ({
          skills: [{
            id: 'sys_default_auto_innovate',
            title: '系统默认自动创新',
            body: 'new',
            is_default: true,
          }],
        }),
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    assert.equal(rowRadio(noneRow(ctx.byId.popupSkillList)).checked, true);
    assert.equal(ctx.lastSet().pageAdvisorActiveSkillId, '');
    assert.equal(
      ctx.lastSet().pageAdvisorPromptSkills.find((s) => s.id === 'sys_default_auto_innovate').body,
      'new',
    );
    assert.equal(ctx.lastSet().pageAdvisorPromptSkills.length, 5);
  });

  it('T6 未登录保存只落本机、不 PUT', async () => {
    const puts = [];
    ctx = bootPopup({
      loggedIn: false,
      skills: [],
      api: {
        getPromptSkills: async () => ({ skills: [], active_skill_id: '', revision: 'x' }),
        putPromptSkills: async () => { puts.push(1); return { revision: 'y', skills: [], active_skill_id: '' }; },
      },
    });
    ctx.api.loadSkills();
    await flushAll();
    ctx.byId.btnSkillNew.dispatch('click');
    ctx.byId.popupSkillTitle.value = '本机草稿';
    ctx.byId.popupSkillBody.value = 'body';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();
    assert.equal(puts.length, 0);
    assert.ok(ctx.storageSets.some((s) => Array.isArray(s.pageAdvisorPromptSkills)
      && s.pageAdvisorPromptSkills.some((sk) => sk.title === '本机草稿')));
  });
});

describe('Popup 已保存 Skill：新建自定义技能', () => {
  let ctx;

  it('点进类别后点新建，类别预填为当前类，保存不改写系统条目', async () => {
    const puts = [];
    const api = {
      getPromptSkills: async () => ({
        revision: 'r1',
        active_skill_id: '',
        skills: [{
          id: 'sys_tendency_a11y', title: '系统默认·无障碍', tendency: 'a11y', body: '目录正文', readonly: true,
        }],
      }),
      putPromptSkills: async (_t, wid, payload) => {
        puts.push({ wid, payload });
        return { revision: 'r2', skills: payload.skills, active_skill_id: payload.active_skill_id };
      },
    };
    ctx = bootPopup({ api, loggedIn: true });
    await ctx.api.loadSkills();
    await flushAll();

    openCategory(ctx.byId.popupSkillList, 'a11y');
    const group = groupEls(ctx.byId.popupSkillList)
      .find((g) => g.getAttribute('data-tendency') === 'a11y');
    assert.equal(
      (group.children || []).some((el) => String(el.className || '').includes('popup-skill-category-source')),
      false,
    );
    assert.ok(skillRowByTitle(ctx.byId.popupSkillList, /系统默认·无障碍/));
    ctx.byId.btnSkillNew.dispatch('click');
    assert.equal(ctx.byId.popupSkillTendency.value, 'a11y');
    ctx.byId.popupSkillTitle.value = '我的无障碍';
    ctx.byId.popupSkillBody.value = '自定义正文';
    ctx.byId.btnSkillSave.dispatch('click');
    await flushAll();

    const saved = ctx.lastSet();
    const overwritten = (saved.pageAdvisorPromptSkills || []).find(
      (sk) => sk.id === 'sys_tendency_a11y' && sk.body === '自定义正文',
    );
    assert.equal(overwritten, undefined, '不得把自定义正文写进系统条目');
    const draft = saved.pageAdvisorPromptSkills.find((sk) => sk.title === '我的无障碍');
    assert.ok(draft);
    assert.equal(draft.tendency, 'a11y');
    assert.notEqual(draft.id, 'sys_tendency_a11y');
    const lastPut = puts.at(-1);
    assert.ok(lastPut, '须 PUT 到工作空间');
    assert.equal(
      lastPut.payload.skills.some((sk) => sk.id === 'sys_tendency_a11y'),
      false,
      'PUT 不得包含只读目录 id',
    );
  });
});
