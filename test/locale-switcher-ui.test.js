'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const switcher = require('../lib/locale-switcher-ui.js');

function fakeSelect(initial) {
  const listeners = {};
  return {
    value: initial,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    async change(value) {
      this.value = value;
      await listeners.change({ target: this });
    },
  };
}

describe('PluginLocaleSwitcher', () => {
  it('change sets locale and PATCHes when sendMessage is provided', async () => {
    const sent = [];
    const applied = [];
    const select = fakeSelect('zh-CN');
    const i18n = {
      getLocale: () => i18n._loc,
      setLocale: (l) => {
        i18n._loc = l;
        return l;
      },
      normalize: (raw) => (String(raw) === 'en' ? 'en' : 'zh-CN'),
      applyDom: () => applied.push('dom'),
      _loc: 'zh-CN',
    };
    switcher.bind({
      select,
      i18n,
      sendMessage: async (msg) => {
        sent.push(msg);
      },
      onApplied: () => applied.push('guide'),
    });
    await select.change('en');
    assert.equal(i18n._loc, 'en');
    assert.deepEqual(sent, [{ action: 'syncPreferredLocale', locale: 'en' }]);
    assert.ok(applied.includes('dom'));
    assert.ok(applied.includes('guide'));
  });

  it('change still applies locale when sendMessage throws', async () => {
    const select = fakeSelect('zh-CN');
    const i18n = {
      getLocale: () => i18n._loc,
      setLocale: (l) => {
        i18n._loc = l;
        return l;
      },
      normalize: (raw) => (String(raw) === 'en' ? 'en' : 'zh-CN'),
      applyDom: () => {},
      _loc: 'zh-CN',
    };
    switcher.bind({
      select,
      i18n,
      sendMessage: async () => {
        throw new Error('offline');
      },
    });
    await select.change('en');
    assert.equal(i18n._loc, 'en');
  });
});
