'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-locale-prompt.js');
const builtin = require('../lib/page-advisor-builtin-prompt.js');

test('Chrome Prompt API：zh 不可用时回退到 en，避免 probe 直接 unavailable', async () => {
  const seen = [];
  const languageModel = {
    async availability(options) {
      seen.push(options);
      const lang = options
        && options.expectedInputs
        && options.expectedInputs[0]
        && options.expectedInputs[0].languages
        && options.expectedInputs[0].languages[0];
      if (lang === 'zh' || lang === 'zh-CN') return 'unavailable';
      if (lang === 'en') return 'available';
      return 'unavailable';
    },
  };
  const opts = await builtin.resolveLanguageOptions(languageModel, 'zh-CN');
  assert.deepEqual(opts.expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.equal(await builtin.probe(languageModel, 'zh-CN'), 'available');
  assert.ok(seen.length >= 2);
});
