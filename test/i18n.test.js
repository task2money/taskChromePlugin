const test = require('node:test')
const assert = require('node:assert/strict')

test('plugin i18n switches login label', () => {
  // fresh load
  delete require.cache[require.resolve('../lib/i18n.js')]
  delete require.cache[require.resolve('../lib/i18n-messages.js')]
  const i18n = require('../lib/i18n.js')
  require('../lib/i18n-messages.js')
  i18n.setLocale('en')
  assert.equal(i18n.t('login'), 'Log in')
  i18n.setLocale('zh-CN')
  assert.equal(i18n.t('login'), '登录')
})
