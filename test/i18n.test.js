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

test('plugin i18n panel float keys', () => {
  delete require.cache[require.resolve('../lib/i18n.js')]
  delete require.cache[require.resolve('../lib/i18n-messages.js')]
  delete require.cache[require.resolve('../lib/i18n-ui-messages.js')]
  const i18n = require('../lib/i18n.js')
  require('../lib/i18n-messages.js')
  require('../lib/i18n-ui-messages.js')
  i18n.setLocale('en')
  assert.equal(i18n.t('floatQuickCreate'), 'Quick create task')
  assert.equal(i18n.t('panelTabSingle'), '📋 Single request')
})

test('自动运行提示键在 zh-CN / en 均有独立译文', () => {
  delete require.cache[require.resolve('../lib/i18n.js')]
  delete require.cache[require.resolve('../lib/i18n-messages.js')]
  delete require.cache[require.resolve('../lib/i18n-ui-messages.js')]
  const i18n = require('../lib/i18n.js')
  require('../lib/i18n-messages.js')
  require('../lib/i18n-ui-messages.js')
  const tables = i18n.getMessageTables()
  const keys = [
    'panelAutoRunHintPickProject',
    'panelAutoRunHintNotAllowed',
    'panelAutoRunHintPickImage',
    'panelAutoRunHintNoTemplate',
    'panelAutoRunHintReady',
  ]
  for (const key of keys) {
    assert.equal(typeof tables['zh-CN'][key], 'string', `zh-CN 缺 ${key}`)
    assert.equal(typeof tables.en[key], 'string', `en 缺 ${key}`)
    assert.notEqual(tables.en[key], tables['zh-CN'][key], `${key} 的 en 译文未落地`)
    assert.doesNotMatch(tables.en[key], /[㐀-䶿一-鿿]/, `${key} 的 en 译文仍含中文`)
  }
})

test('applyDom 用 SSOT 品牌名替换静态文案里的 {brand}', () => {
  delete require.cache[require.resolve('../lib/i18n.js')]
  delete require.cache[require.resolve('../lib/i18n-messages.js')]
  delete require.cache[require.resolve('../lib/i18n-ui-messages.js')]
  const i18n = require('../lib/i18n.js')
  require('../lib/i18n-messages.js')
  require('../lib/i18n-ui-messages.js')
  const { PLUGIN_DISPLAY_NAME } = require('../lib/plugin-brand.js')
  globalThis.PLUGIN_DISPLAY_NAME = PLUGIN_DISPLAY_NAME
  try {
    const makeEl = (key) => ({
      attrs: { 'data-i18n': key },
      textContent: '',
      getAttribute(name) {
        return this.attrs[name] || null
      },
    })
    const el = makeEl('popupDevToolsBody')
    i18n.setLocale('en')
    i18n.applyDom({ querySelectorAll: (sel) => (sel === '[data-i18n]' ? [el] : []) })
    assert.equal(
      el.textContent,
      `Open the ${PLUGIN_DISPLAY_NAME} panel to create tasks or batch-capture errors`,
    )
    assert.doesNotMatch(el.textContent, /\{brand\}/)
  } finally {
    delete globalThis.PLUGIN_DISPLAY_NAME
  }
})
