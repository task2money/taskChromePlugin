'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-locale-prompt.js');
const lang = require('../lib/page-advisor-builtin-language.js');

test('preferred 语言选项把 zh-CN 编成 zh', () => {
  assert.deepEqual(lang.languageOptions('zh-CN'), {
    expectedInputs: [{ type: 'text', languages: ['zh'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh'] }],
  });
});

test('zh 不可用时 resolveLanguageOptions 回退 en 并缓存给下载手势', async () => {
  const languageModel = {
    async availability(options) {
      const langTag = options
        && options.expectedInputs
        && options.expectedInputs[0]
        && options.expectedInputs[0].languages
        && options.expectedInputs[0].languages[0];
      if (langTag === 'zh') return 'unavailable';
      if (langTag === 'en') return 'downloadable';
      return 'unavailable';
    },
  };
  const opts = await lang.resolveLanguageOptions(languageModel, 'zh-CN');
  assert.deepEqual(opts.expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.deepEqual(lang.cachedLanguageOptions('zh-CN'), opts);
});
