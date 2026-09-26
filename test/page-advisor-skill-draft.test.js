'use strict';

/**
 * OPT-20260926-010：Popup 失焦即卸载，Skill 编辑区的未保存正文要能回来。
 * 草稿与直连 Key 的 pageAdvisorLlmDraft 分开存放，且绝不可写进已保存的 Skill 记录。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Draft = require('../lib/page-advisor-skill-draft.js');

const root = path.join(__dirname, '..');

function fakeStorage(initial = {}) {
  const mem = { ...initial };
  return {
    mem,
    async get(keys) {
      const out = {};
      for (const k of keys || []) {
        if (k in mem) out[k] = mem[k];
      }
      return out;
    },
    async set(patch) {
      Object.assign(mem, patch);
    },
    async remove(keys) {
      for (const k of keys || []) delete mem[k];
    },
  };
}

describe('PageAdvisorSkillDraft', () => {
  it('uses its own storage key, not the LLM key draft', () => {
    assert.equal(Draft.DRAFT_KEY, 'pageAdvisorSkillDraft');
    assert.notEqual(Draft.DRAFT_KEY, 'pageAdvisorLlmDraft');
  });

  it('parses a draft and drops an empty form', () => {
    const parsed = Draft.parseDraft({ skillId: 's1', title: '标题', tendency: 'perf', body: '正文' });
    assert.deepEqual(parsed, { skillId: 's1', title: '标题', tendency: 'perf', body: '正文' });
    assert.equal(Draft.parseDraft({ skillId: 's1', title: '   ', body: '' }), null);
    assert.equal(Draft.parseDraft(null), null);
    assert.equal(Draft.parseDraft([1, 2]), null);
  });

  it('restores a draft only for the skill it belongs to', () => {
    const draft = { skillId: 's1', title: '标题', body: '正文' };
    assert.equal(Draft.shouldRestoreDraft(draft, 's1'), true);
    assert.equal(Draft.shouldRestoreDraft(draft, 's2'), false);
    // 老草稿不能灌进「新建」
    assert.equal(Draft.shouldRestoreDraft(draft, ''), false);
    assert.equal(Draft.shouldRestoreDraft({ skillId: '', title: 'x', body: 'y' }, ''), true);
    assert.equal(Draft.shouldRestoreDraft(null, 's1'), false);
  });

  it('round-trips through storage and clears on save', async () => {
    const store = fakeStorage();
    await Draft.saveDraftToStorage({ skillId: 's1', title: '标题', tendency: 'perf', body: '正文' }, store);
    assert.deepEqual(store.mem.pageAdvisorSkillDraft, {
      skillId: 's1', title: '标题', tendency: 'perf', body: '正文',
    });

    const loaded = await Draft.loadDraftFromStorage(store);
    assert.equal(loaded.body, '正文');
    assert.equal(Draft.shouldRestoreDraft(loaded, 's1'), true);

    await Draft.clearDraftFromStorage(store);
    assert.equal(store.mem.pageAdvisorSkillDraft, undefined);
    assert.equal(await Draft.loadDraftFromStorage(store), null);
  });

  it('an emptied form clears the stored draft instead of keeping a stale one', async () => {
    const store = fakeStorage({ pageAdvisorSkillDraft: { skillId: 's1', title: 'a', body: 'b' } });
    assert.equal(await Draft.saveDraftToStorage({ skillId: 's1', title: '', body: '' }, store), null);
    assert.equal(store.mem.pageAdvisorSkillDraft, undefined);
  });

  it('never throws when storage is unavailable', async () => {
    assert.equal(await Draft.saveDraftToStorage({ skillId: 's1', title: 'a', body: 'b' }, null), null);
    assert.equal(await Draft.loadDraftFromStorage(null), null);
    assert.equal(await Draft.clearDraftFromStorage(null), false);
  });

  it('is wired into the popup skill editor (persist on input, clear on save)', () => {
    const skills = fs.readFileSync(path.join(root, 'popup/popup-prompt-skills.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'popup/popup-prompt-skill-ui.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
    assert.match(html, /lib\/page-advisor-skill-draft\.js/);
    assert.match(skills, /PageAdvisorSkillDraft/);
    // 三个编辑框都要在输入时落草稿
    for (const id of ['#popupSkillTitle', '#popupSkillTendency', '#popupSkillBody']) {
      assert.ok(skills.indexOf(id) >= 0, `${id} 应在接线代码里`);
    }
    assert.match(skills, /persistSkillDraft/);
    assert.match(skills, /clearSkillDraft/);
    // 回填发生在拥有编辑框 DOM 的 UI 模块里，由 fillEditor 触发
    assert.match(ui, /restoreSkillDraft/);
    assert.match(ui, /fillEditor[\s\S]*restoreSkillDraft/);
  });
});
