'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PageAdvisorPromptSkills = require('../lib/page-advisor-prompt-skills.js');
const PageAdvisorLLM = require('../lib/page-advisor-llm-client.js');

describe('PageAdvisorPromptSkills', () => {
  it('upsert then getActive; switch active changes getActive body', () => {
    let st = PageAdvisorPromptSkills.emptyStore();
    const a = PageAdvisorPromptSkills.upsertSkill(st, {
      id: 'a',
      title: '无障碍',
      tendency: 'a11y',
      body: '优先对比度与键盘',
    });
    st = a.store;
    st = PageAdvisorPromptSkills.setActive(st, 'a').store;
    const b = PageAdvisorPromptSkills.upsertSkill(st, {
      id: 'b',
      title: '转化',
      tendency: 'conversion',
      body: '优先转化文案',
    });
    st = b.store;
    assert.equal(PageAdvisorPromptSkills.getActive(st).body, '优先对比度与键盘');
    st = PageAdvisorPromptSkills.setActive(st, 'b').store;
    assert.equal(PageAdvisorPromptSkills.getActive(st).body, '优先转化文案');
  });

  it('rejects more than 20 skills and body over 8000 chars', () => {
    let st = PageAdvisorPromptSkills.emptyStore();
    for (let i = 0; i < 20; i += 1) {
      st = PageAdvisorPromptSkills.upsertSkill(st, {
        id: `id${i}`,
        title: `t${i}`,
        body: 'x',
      }).store;
    }
    assert.throws(
      () => PageAdvisorPromptSkills.upsertSkill(st, { title: 'overflow', body: 'y' }),
      /20/,
    );
    assert.throws(
      () => PageAdvisorPromptSkills.upsertSkill(PageAdvisorPromptSkills.emptyStore(), {
        title: 'long',
        body: 'z'.repeat(8001),
      }),
      /8000/,
    );
  });

  it('remove clears active when deleted', () => {
    let st = PageAdvisorPromptSkills.emptyStore();
    st = PageAdvisorPromptSkills.upsertSkill(st, { id: 'a', title: 'A', body: '1' }).store;
    st = PageAdvisorPromptSkills.setActive(st, 'a').store;
    st = PageAdvisorPromptSkills.removeSkill(st, 'a').store;
    assert.equal(st.activeSkillId, '');
    assert.equal(PageAdvisorPromptSkills.getActive(st), null);
  });

  it('load/save storage roundtrip', async () => {
    const mem = {};
    const api = {
      get: async (keys) => {
        const out = {};
        for (const k of keys) out[k] = mem[k];
        return out;
      },
      set: async (obj) => {
        Object.assign(mem, obj);
      },
    };
    const saved = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { id: 's1', title: 'T', body: 'hello' },
    ).store;
    saved.activeSkillId = 's1';
    await PageAdvisorPromptSkills.saveToStorage(saved, api);
    const loaded = await PageAdvisorPromptSkills.loadFromStorage(api);
    assert.equal(loaded.skills[0].body, 'hello');
    assert.equal(loaded.activeSkillId, 's1');
  });

  it('reconcileCloud pulls remote when present; uploads when remote empty', () => {
    const local = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { id: 'l1', title: 'Local', body: 'only-local' },
    ).store;
    const pulled = PageAdvisorPromptSkills.reconcileCloud(local, {
      skills: [{ id: 'r1', title: 'Cloud', body: 'from-saas', updated_at: 2 }],
      active_skill_id: 'r1',
    });
    assert.equal(pulled.action, 'pull');
    assert.equal(pulled.store.skills[0].body, 'from-saas');
    const uploaded = PageAdvisorPromptSkills.reconcileCloud(local, { skills: [] });
    assert.equal(uploaded.action, 'upload');
    assert.equal(uploaded.store.skills[0].body, 'only-local');
  });

  it('keeps user-defined tendency instead of coercing to custom', () => {
    const rec = PageAdvisorPromptSkills.upsertSkill(PageAdvisorPromptSkills.emptyStore(), {
      title: '品牌',
      tendency: '品牌调性',
      body: 'x',
    });
    assert.equal(rec.skill.tendency, '品牌调性');
    assert.equal(PageAdvisorPromptSkills.normalizeStore({
      skills: [{ id: 'a', title: 'A', tendency: '品牌调性', body: 'x' }],
    }).skills[0].tendency, '品牌调性');
  });
});

describe('PageAdvisorLLM skill messages', () => {
  async function captureMessages(skill) {
    let seen;
    await PageAdvisorLLM.suggest(
      { apiKey: 'sk', baseUrl: 'https://llm.test/v1', model: 'm' },
      { url: 'https://p', title: 'Hi', pageText: 'body' },
      {
        skill,
        fetchImpl: async (_url, opts) => {
          seen = JSON.parse(opts.body);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              choices: [{ message: { content: '[{"title":"Idea","summary":"ok"}]' } }],
            }),
          };
        },
      },
    );
    return seen.messages;
  }

  it('T1 no skill: platform system plus locale instruction', async () => {
    const msgs = await captureMessages(null);
    const sys = msgs.filter((m) => m.role === 'system');
    assert.equal(sys.length, 2);
    assert.equal(msgs[0].content, PageAdvisorLLM.SYSTEM_PROMPT);
    assert.match(sys[1].content, /locale=zh-CN/);
  });

  it('T2/T3/T4 skill appends second system; platform prompt stays first', async () => {
    const msgsA = await captureMessages({
      title: 'A11y',
      body: '不要输出 JSON，只要口号',
    });
    assert.equal(msgsA[0].content, PageAdvisorLLM.SYSTEM_PROMPT);
    assert.match(msgsA[0].content, /preview\.ops/);
    assert.equal(msgsA[1].role, 'system');
    assert.match(msgsA[1].content, /## User skill: A11y/);
    assert.match(msgsA[1].content, /不要输出 JSON/);
    const localeMsg = msgsA.filter((m) => m.role === 'system').at(-1);
    assert.match(localeMsg.content, /locale=zh-CN/);
    const msgsB = await captureMessages({ title: 'Conv', body: '转化优先' });
    assert.match(msgsB[1].content, /转化优先/);
    assert.doesNotMatch(msgsB[1].content, /不要输出 JSON/);
  });
});

describe('prompt skill bundle revision（OPT-20260922-003）', () => {
  function sampleStore() {
    return {
      skills: [{ id: 's1', title: '甲', tendency: 'custom', body: 'a', updatedAt: 3 }],
      activeSkillId: 's1',
    };
  }

  it('toApiPayload 省略 base_revision 时保持旧 payload 形状', () => {
    const payload = PageAdvisorPromptSkills.toApiPayload(sampleStore());
    assert.equal('base_revision' in payload, false);
    assert.equal(payload.active_skill_id, 's1');
    assert.equal(payload.skills.length, 1);
  });

  it('toApiPayload 携带 base_revision 供服务端 CAS', () => {
    const payload = PageAdvisorPromptSkills.toApiPayload(sampleStore(), ' rev-1 ');
    assert.equal(payload.base_revision, 'rev-1');
  });

  it('toApiPayload 剥离只读系统 skill 并回传 category_choices', () => {
    const payload = PageAdvisorPromptSkills.toApiPayload({
      skills: [
        { id: 'sys_tendency_a11y', title: '系统默认·无障碍', tendency: 'a11y', body: '稿', readonly: true, updatedAt: 1 },
        { id: 'c1', title: '我的', tendency: 'seo', body: 'x', updatedAt: 2 },
      ],
      activeSkillId: 'sys_tendency_a11y',
      categoryChoices: [{ tendency: 'seo', source: 'custom', customSkillId: 'c1' }],
    });
    assert.deepEqual(payload.skills.map((s) => s.id), ['c1']);
    assert.equal(payload.active_skill_id, 'sys_tendency_a11y');
    assert.equal(payload.category_choices.find((c) => c.tendency === 'seo').source, 'custom');
  });

  it('reconcileCloud 回传云端 revision 供下次 PUT 使用', () => {
    const rec = PageAdvisorPromptSkills.reconcileCloud(sampleStore(), {
      skills: [],
      active_skill_id: '',
      revision: 'rev-cloud',
    });
    assert.equal(rec.action, 'upload');
    assert.equal(rec.revision, 'rev-cloud');

    const empty = PageAdvisorPromptSkills.reconcileCloud(PageAdvisorPromptSkills.emptyStore(), {});
    assert.equal(empty.revision, '');
  });
});

describe('prompt skill per-item syncTarget', () => {
  it('new skill defaults to local storage', () => {
    const st = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { title: '本机', body: 'x' },
    ).store;
    assert.equal(st.skills[0].syncTarget, PageAdvisorPromptSkills.SYNC_LOCAL);
  });

  it('upsert keeps existing syncTarget when omitted', () => {
    let st = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { id: 's1', title: 'A', body: 'a', syncTarget: 'ws-1' },
    ).store;
    st = PageAdvisorPromptSkills.upsertSkill(st, { id: 's1', title: 'A2', body: 'b' }).store;
    assert.equal(st.skills[0].syncTarget, 'ws-1');
    assert.equal(st.skills[0].title, 'A2');
  });

  it('mergeWorkspaceBundle keeps local-only and other workspace skills', () => {
    let st = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { id: 'loc', title: 'L', body: 'local', syncTarget: 'local' },
    ).store;
    st = PageAdvisorPromptSkills.upsertSkill(st, {
      id: 'b', title: 'B', body: 'other', syncTarget: 'ws-b',
    }).store;
    st = PageAdvisorPromptSkills.upsertSkill(st, {
      id: 'a', title: 'oldA', body: 'stale', syncTarget: 'ws-a',
    }).store;
    const rec = PageAdvisorPromptSkills.mergeWorkspaceBundle(st, {
      skills: [{ id: 'a', title: 'cloudA', body: 'from-a', updated_at: 9 }],
      active_skill_id: 'a',
      revision: 'rev-a',
    }, 'ws-a');
    assert.equal(rec.action, 'pull');
    assert.equal(rec.revision, 'rev-a');
    const byId = Object.fromEntries(rec.store.skills.map((s) => [s.id, s]));
    assert.equal(byId.loc.body, 'local');
    assert.equal(byId.b.syncTarget, 'ws-b');
    assert.equal(byId.a.body, 'from-a');
    assert.equal(byId.a.syncTarget, 'ws-a');
  });

  it('buildWorkspacePutStore drops unshared local skills and keeps colleague ids', () => {
    let st = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { id: 'mine', title: 'Mine', body: 'm', syncTarget: 'ws-a' },
    ).store;
    st = PageAdvisorPromptSkills.upsertSkill(st, {
      id: 'priv', title: 'Priv', body: 'p', syncTarget: 'local',
    }).store;
    const put = PageAdvisorPromptSkills.buildWorkspacePutStore(st, {
      skills: [
        { id: 'colleague', title: 'C', body: 'c' },
        { id: 'mine', title: 'old', body: 'old' },
      ],
    }, 'ws-a');
    const ids = put.skills.map((s) => s.id).sort();
    assert.deepEqual(ids, ['colleague', 'mine']);
    assert.equal(put.skills.find((s) => s.id === 'mine').body, 'm');
  });

  it('empty syncTarget follows legacy default workspace only', () => {
    const skill = { id: 'x', syncTarget: '' };
    assert.equal(
      PageAdvisorPromptSkills.skillTargetsWorkspace(skill, 'ws-default', 'ws-default'),
      true,
    );
    assert.equal(
      PageAdvisorPromptSkills.skillTargetsWorkspace(skill, 'ws-other', 'ws-default'),
      false,
    );
  });

  it('buildPromptSkillsPageHref 对齐 SaaS 独立页路径', () => {
    assert.equal(
      PageAdvisorPromptSkills.buildPromptSkillsPageHref({
        baseUrl: 'https://aidevpush.com/api',
        tenantId: 'tid-1',
        workspaceId: 'ws-b',
      }),
      'https://aidevpush.com/tenant/tid-1/settings/workspace/ws-b/prompt-skills/',
    );
    assert.equal(
      PageAdvisorPromptSkills.buildPromptSkillsPageHref({ baseUrl: 'https://aidevpush.com', tenantId: '', workspaceId: 'ws-b' }),
      '',
    );
    assert.equal(PageAdvisorPromptSkills.workspaceIdForSkill({ syncTarget: 'local' }, 'ws-a'), 'ws-a');
    assert.equal(PageAdvisorPromptSkills.workspaceIdForSkill({ syncTarget: 'ws-b' }, 'ws-a'), 'ws-b');
  });

  it('applySystemCatalogDefault 空本机无目录时预埋五条稳定 id 并选中 custom', () => {
    const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(
      PageAdvisorPromptSkills.emptyStore(),
      { skills: [] },
      'local',
    );
    assert.equal(rec.action, 'applied');
    const ids = rec.store.skills.map((s) => s.id).sort();
    assert.deepEqual(ids, [
      'sys_default_auto_innovate',
      'sys_tendency_a11y',
      'sys_tendency_conversion',
      'sys_tendency_perf',
      'sys_tendency_seo',
    ].sort());
    assert.equal(rec.store.activeSkillId, 'sys_default_auto_innovate');
    rec.store.skills.forEach((s) => assert.equal(s.readonly, true));
    const a11y = rec.store.skills.find((s) => s.id === 'sys_tendency_a11y');
    assert.match(a11y.body, /WCAG 2\.1 AA/);
    assert.doesNotMatch(a11y.body, /你优先从无障碍（WCAG）角度改进当前页面/);
    const custom = rec.store.skills.find((s) => s.id === 'sys_default_auto_innovate');
    assert.match(custom.body, /资深网页产品\+UIUX创新设计师/);
  });

  it('applySystemCatalogDefault inserts default and selects when local empty', () => {
    const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(
      PageAdvisorPromptSkills.emptyStore(),
      {
        skills: [
          { id: 'other', title: '其它', body: 'x', is_default: false },
          { id: 'sys_default_auto_innovate', title: '系统默认自动创新', body: '平台提示', is_default: true },
        ],
      },
      'local',
    );
    assert.equal(rec.action, 'applied');
    assert.equal(rec.store.activeSkillId, 'sys_default_auto_innovate');
    assert.equal(rec.store.skills.find((s) => s.id === 'sys_default_auto_innovate').body, '平台提示');
    assert.equal(rec.store.skills.find((s) => s.id === 'sys_tendency_a11y').title, '系统默认·无障碍');
    assert.equal(rec.store.skills.some((s) => s.id === 'other'), false);
    assert.equal(rec.store.skills.length, 5);
    assert.equal(rec.store.skills.find((s) => s.id === 'sys_default_auto_innovate').readonly, true);
  });

  it('removeSkill rejects readonly system copies', () => {
    const st = {
      skills: [{ id: 'sys_default_auto_innovate', title: '系统默认自动创新', body: 'p', readonly: true }],
      activeSkillId: '',
    };
    assert.throws(
      () => PageAdvisorPromptSkills.removeSkill(st, 'sys_default_auto_innovate'),
      /read-only/,
    );
  });

  it('applySystemCatalogDefault does not override 不应用 when default id already local', () => {
    const st = {
      skills: [{
        id: 'sys_default_auto_innovate',
        title: '系统默认自动创新',
        tendency: 'custom',
        body: 'old',
        syncTarget: 'local',
        readonly: true,
      }],
      activeSkillId: '',
    };
    const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(st, {
      skills: [{ id: 'sys_default_auto_innovate', title: '系统默认自动创新', body: 'new', is_default: true }],
    }, 'local', { overlayExisting: true });
    assert.equal(rec.action, 'applied');
    assert.equal(rec.store.activeSkillId, '');
    assert.equal(rec.store.skills.find((s) => s.id === 'sys_default_auto_innovate').body, 'new');
    assert.equal(rec.store.skills.length, 5);
  });

  it('applySystemCatalogDefault 未登录也覆盖本机短稿且不改 active', () => {
    const st = {
      skills: [{
        id: 'sys_tendency_a11y',
        title: '系统默认·无障碍',
        tendency: 'a11y',
        body: '你优先从无障碍（WCAG）角度改进当前页面。',
        syncTarget: 'local',
        readonly: true,
      }],
      activeSkillId: '',
    };
    const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(st, { skills: [] }, 'local');
    assert.equal(rec.action, 'applied');
    assert.equal(rec.store.activeSkillId, '');
    const a11y = rec.store.skills.find((s) => s.id === 'sys_tendency_a11y');
    assert.match(a11y.body, /WCAG 2\.1 AA/);
    assert.doesNotMatch(a11y.body, /你优先从无障碍（WCAG）角度改进当前页面/);
  });

  it('toApiPayload 剥离全部五条预埋稳定 id', () => {
    const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(
      PageAdvisorPromptSkills.emptyStore(), { skills: [] }, 'local',
    );
    rec.store.skills.push({
      id: 'c1', title: '我的', tendency: 'seo', body: 'x', updatedAt: 2, syncTarget: 'local',
    });
    rec.store.activeSkillId = 'c1';
    const payload = PageAdvisorPromptSkills.toApiPayload(rec.store);
    assert.deepEqual(payload.skills.map((s) => s.id), ['c1']);
  });

  it('mergeWorkspaceBundle adopts remote active only on first sight', () => {
    const first = PageAdvisorPromptSkills.mergeWorkspaceBundle(
      PageAdvisorPromptSkills.emptyStore(),
      {
        skills: [{ id: 'sys_default_auto_innovate', title: '默认', body: 'p', updated_at: 1 }],
        active_skill_id: 'sys_default_auto_innovate',
      },
      'ws-a',
    );
    assert.equal(first.store.activeSkillId, 'sys_default_auto_innovate');
    const cleared = PageAdvisorPromptSkills.setActive(first.store, '').store;
    const second = PageAdvisorPromptSkills.mergeWorkspaceBundle(cleared, {
      skills: [{ id: 'sys_default_auto_innovate', title: '默认', body: 'p', updated_at: 1 }],
      active_skill_id: 'sys_default_auto_innovate',
    }, 'ws-a');
    assert.equal(second.store.activeSkillId, '');
  });
});

describe('create-task does not embed prompt skill fence', () => {
  it('T6 payload builder has no taskplugin-prompt-skill', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/create-task-payload.js'),
      'utf8',
    );
    assert.doesNotMatch(src, /taskplugin-prompt-skill/);
  });
});

/**
 * OPT-20260922-043：预设类别可选「系统默认 / 自行定制」。系统目录条只读，
 * 定制必须 clone 成本机新 id，且选择记入 categoryChoices（PUT 上行 category_choices）。
 */
describe('预设类别来源选择 selectCategorySource（OPT-20260922-043）', () => {
  const S = require('../lib/page-advisor-prompt-skills.js');
  const base = {
    skills: [{
      id: 'sys_tendency_a11y', title: '系统默认·无障碍', tendency: 'a11y', body: '目录正文', readonly: true,
    }],
    activeSkillId: '',
  };

  it('定制：clone 成新 id 的本机草稿，正文同目录稿，记入 categoryChoices', () => {
    const rec = S.selectCategorySource(base, 'a11y', 'custom');
    assert.equal(rec.created, true);
    assert.ok(rec.customSkillId && rec.customSkillId !== 'sys_tendency_a11y');
    const clone = rec.store.skills.find((s) => s.id === rec.customSkillId);
    assert.equal(clone.body, '目录正文');
    assert.equal(clone.title, '系统默认·无障碍');
    assert.equal(clone.tendency, 'a11y');
    assert.notEqual(clone.readonly, true, '草稿必须可编辑');
    const choice = rec.store.categoryChoices.find((c) => c.tendency === 'a11y');
    assert.deepEqual({ source: choice.source, customSkillId: choice.customSkillId },
      { source: 'custom', customSkillId: rec.customSkillId });
    assert.equal(rec.store.skills.filter((s) => s.id === 'sys_tendency_a11y').length, 1, '系统条保持原样');
  });

  it('已存在本机草稿时再点定制不重复 clone', () => {
    const first = S.selectCategorySource(base, 'a11y', 'custom');
    const second = S.selectCategorySource(first.store, 'a11y', 'custom');
    assert.equal(second.created, false);
    assert.equal(second.customSkillId, first.customSkillId);
    assert.equal(second.store.skills.length, first.store.skills.length);
  });

  it('切回系统默认：来源记 system，草稿保留（不删用户内容）', () => {
    const custom = S.selectCategorySource(base, 'a11y', 'custom');
    const back = S.selectCategorySource(custom.store, 'a11y', 'system');
    const choice = back.store.categoryChoices.find((c) => c.tendency === 'a11y');
    assert.equal(choice.source, 'system');
    assert.equal(back.store.skills.some((s) => s.id === custom.customSkillId), true);
    assert.equal(S.categorySourceOf(back.store, 'a11y'), 'system');
  });

  it('无对应系统稿时不动 store', () => {
    const empty = { skills: [], activeSkillId: '' };
    const rec = S.selectCategorySource(empty, 'a11y', 'custom');
    assert.equal(rec.created, false);
    assert.deepEqual(rec.store.skills, []);
    assert.equal(S.categorySourceOf(empty, 'a11y'), 'system');
  });
});
