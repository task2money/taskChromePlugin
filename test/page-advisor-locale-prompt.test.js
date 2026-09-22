'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PageAdvisorLocalePrompt = require('../lib/page-advisor-locale-prompt.js');

describe('PageAdvisorLocalePrompt', () => {
  it('normalize maps en-US to en and empty to zh-CN', () => {
    assert.equal(PageAdvisorLocalePrompt.normalize('en-US'), 'en');
    assert.equal(PageAdvisorLocalePrompt.normalize('EN'), 'en');
    assert.equal(PageAdvisorLocalePrompt.normalize(''), 'zh-CN');
    assert.equal(PageAdvisorLocalePrompt.normalize('zh'), 'zh-CN');
    assert.equal(PageAdvisorLocalePrompt.normalize('fr'), 'zh-CN');
  });

  it('en instruction names locale=en and keeps preview in page language', () => {
    const s = PageAdvisorLocalePrompt.replyInstruction('en');
    assert.match(s, /locale=en/);
    assert.match(s, /title, summary, and detail in English/);
    assert.match(s, /do not translate the page into the UI locale/i);
  });

  it('default instruction names locale=zh-CN', () => {
    const s = PageAdvisorLocalePrompt.replyInstruction('');
    assert.match(s, /locale=zh-CN/);
    assert.match(s, /简体中文/);
  });
});
