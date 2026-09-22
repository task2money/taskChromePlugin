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
    let st = PageAdvisorPromptSkills.upsertSkill(
      PageAdvisorPromptSkills.emptyStore(),
      { id: 'sys_default_auto_innovate', title: '系统默认自动创新', body: 'old', syncTarget: 'local' },
    ).store;
    const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(st, {
      skills: [{ id: 'sys_default_auto_innovate', title: '系统默认自动创新', body: 'new', is_default: true }],
    }, 'local');
    assert.equal(rec.action, 'noop');
    assert.equal(rec.store.activeSkillId, '');
    assert.equal(rec.store.skills[0].body, 'old');
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
