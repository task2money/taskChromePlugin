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

  it('T1 no skill: single platform system prompt', async () => {
    const msgs = await captureMessages(null);
    assert.equal(msgs.filter((m) => m.role === 'system').length, 1);
    assert.equal(msgs[0].content, PageAdvisorLLM.SYSTEM_PROMPT);
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
    const msgsB = await captureMessages({ title: 'Conv', body: '转化优先' });
    assert.match(msgsB[1].content, /转化优先/);
    assert.doesNotMatch(msgsB[1].content, /不要输出 JSON/);
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
