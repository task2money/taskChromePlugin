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

  // OPT-20260922-038: locale=en 使用整段英译系统提示，不再只追加一条语言指令。
  it('en system prompt override is English and keeps the JSON contract', () => {
    const s = PageAdvisorLocalePrompt.systemPromptOverride('en-US');
    assert.equal(s.includes('你是网页体验'), false);
    assert.match(s, /web experience and accessibility/);
    assert.match(s, /"category":"a11y\|ux\|perf\|seo\|copy\|other"/);
    assert.match(s, /taskplugin-preview-/);
    assert.match(s, /setAttr allows only aria-\* \/ title \/ placeholder \/ alt \/ href \/ role/);
  });

  it('non-en locales keep the caller default system prompt', () => {
    assert.equal(PageAdvisorLocalePrompt.systemPromptOverride(''), '');
    assert.equal(PageAdvisorLocalePrompt.systemPromptOverride('zh-CN'), '');
    assert.equal(PageAdvisorLocalePrompt.systemPromptOverride('fr'), '');
  });
});
