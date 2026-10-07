'use strict';

/**
 * OPT-20261007-015：自定义技能正文里的外链要能被识别，供编辑器标出。
 * 系统五条正文是纯分析稿、不外出，必须保持零外链（否则标记会全亮，等于没标）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PageAdvisorPromptSkills = require('../lib/page-advisor-prompt-skills.js');
const PageAdvisorPresetSkills = require('../lib/page-advisor-preset-skills.js');

const { externalLinksIn, skillBodyHasExternalLink } = PageAdvisorPromptSkills;

describe('externalLinksIn', () => {
  it('finds http(s) links and dedups repeats', () => {
    const body = '见 https://example.com/a 与 http://x.test/b，再看一次 https://example.com/a';
    assert.deepEqual(externalLinksIn(body), ['https://example.com/a', 'http://x.test/b']);
  });

  it('strips trailing ASCII punctuation from the URL', () => {
    assert.deepEqual(externalLinksIn('参考 https://example.com/docs。'), ['https://example.com/docs']);
    assert.deepEqual(externalLinksIn('见 https://example.com/a, then done'), ['https://example.com/a']);
  });

  it('returns [] for empty or link-free text', () => {
    assert.deepEqual(externalLinksIn(''), []);
    assert.deepEqual(externalLinksIn(null), []);
    assert.deepEqual(externalLinksIn('没有网址的普通提示词，只有 display:none 之类的词'), []);
  });

  it('does not treat a bare scheme-less host or words as a link', () => {
    assert.deepEqual(externalLinksIn('api.deepseek.com 不是链接'), []);
    assert.deepEqual(externalLinksIn('https://'), []);
  });
});

describe('skillBodyHasExternalLink', () => {
  it('flags only custom bodies that carry a link', () => {
    assert.equal(skillBodyHasExternalLink({ body: 'https://evil.example/x' }), true);
    assert.equal(skillBodyHasExternalLink({ body: '纯分析，无链接' }), false);
    assert.equal(skillBodyHasExternalLink(null), false);
  });

  it('all five system preset bodies stay link-free', () => {
    const presets = PageAdvisorPresetSkills.PRESET_CATEGORY_DEFAULTS;
    const keys = Object.keys(presets);
    assert.equal(keys.length, 5, '五条系统正文');
    for (const key of keys) {
      const p = presets[key];
      assert.deepEqual(
        externalLinksIn(p.body),
        [],
        `系统正文 ${p.id} 不应含外链`,
      );
      assert.equal(skillBodyHasExternalLink({ body: p.body }), false, p.id);
    }
  });
});
