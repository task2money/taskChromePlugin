const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-locale-prompt.js');
const builtin = require('../lib/page-advisor-builtin-prompt.js');

test('界面语言只映射成 zh 或 en', () => {
  assert.equal(builtin.promptLanguage('zh-CN'), 'zh');
  assert.equal(builtin.promptLanguage('zh'), 'zh');
  assert.equal(builtin.promptLanguage('en'), 'en');
  assert.equal(builtin.promptLanguage('en-US'), 'en');
});

test('availability、create、prompt 收到同一份语言选项', async () => {
  const seen = [];
  const languageModel = {
    async availability(options) {
      seen.push(options);
      return 'available';
    },
    async create(options) {
      seen.push(options);
      return {
        async prompt(_text, options) {
          seen.push(options);
          return '建议';
        },
        destroy() {},
      };
    },
  };

  const out = await builtin.run(languageModel, 'zh-CN', '这段按钮文案');
  assert.equal(out.availability, 'available');
  assert.equal(out.result, '建议');
  assert.equal(seen.length, 3);
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2]);
  assert.deepEqual(seen[0], {
    expectedInputs: [{ type: 'text', languages: ['zh'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh'] }],
  });
});

test('英文界面三次仍是同一对象', async () => {
  const seen = [];
  const languageModel = {
    async availability(options) {
      seen.push(options);
      return 'available';
    },
    async create(options) {
      seen.push(options);
      return {
        async prompt(_text, promptOptions) {
          seen.push(promptOptions);
          return 'ok';
        },
      };
    },
  };

  await builtin.run(languageModel, 'en-GB', 'label');
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2]);
  assert.deepEqual(seen[0].expectedInputs, [{ type: 'text', languages: ['en'] }]);
});

test('不可用时不创建会话', async () => {
  let created = false;
  const languageModel = {
    async availability() {
      return 'downloadable';
    },
    async create() {
      created = true;
      return { async prompt() { return ''; } };
    },
  };
  const out = await builtin.run(languageModel, 'zh', 'x');
  assert.equal(out.availability, 'downloadable');
  assert.equal(created, false);
});
