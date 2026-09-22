'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('i18n-ui-messages catalog fetch copy', () => {
  it('zh/en expose visible catalog session and empty strings', () => {
    delete require.cache[require.resolve('../lib/i18n-ui-messages.js')];
    const { zh, en } = require('../lib/i18n-ui-messages.js');
    assert.equal(zh.paSkillCatalogNeedSession, '登录会话未就绪，无法拉取系统默认 Skill');
    assert.equal(zh.paSkillCatalogEmpty, '系统提示词目录为空');
    assert.match(en.paSkillCatalogNeedSession, /Sign-in session is not ready/i);
    assert.match(en.paSkillCatalogEmpty, /catalog is empty/i);
  });
});
