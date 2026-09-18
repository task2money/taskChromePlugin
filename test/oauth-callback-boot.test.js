'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BOOT_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'oauth-callback-boot.js'), 'utf8');

/** 等待 order 出现 tag（boot 是 async IIFE，没有对外句柄）。 */
async function waitFor(order, tag, ticks = 50) {
  for (let i = 0; i < ticks && !order.includes(tag); i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(order.includes(tag), `boot 未执行到 ${tag}（实际：${order.join(' → ')}）`);
}

/**
 * 在 vm 中执行 boot 脚本，stub 掉 document / AidevpushI18n / OAuthCallback / chrome。
 * @param {{ failure?: Error }} [opts]
 */
function runBoot(opts = {}) {
  const order = [];
  const renderedTexts = [];
  const resultEl = {
    textContent: '',
    className: '',
  };
  const context = {
    console,
    document: {
      querySelector: () => null,
      getElementById: (id) => (id === 'result' ? resultEl : null),
    },
    location: { search: '?code=c&state=s' },
    chrome: { storage: { local: { get: () => Promise.resolve({}) } }, runtime: { sendMessage: () => Promise.resolve({}) } },
    globalThis: null,
    AidevpushI18n: {
      hydrateFromStorage: () => {
        order.push('hydrate');
        return Promise.resolve();
      },
      applyDom: () => {
        order.push('applyDom');
      },
    },
    OAuthCallback: {
      SESSION_KEY: 'oauthPkceSession',
      handleCallback: () => {
        order.push('handle');
        if (opts.failure) return Promise.reject(opts.failure);
        return Promise.resolve({ status: 'ok', message: 'ok' });
      },
    },
    tx: (key, params) => (params && params.reason ? `${key}:${params.reason}` : key),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(BOOT_SRC, context, { filename: 'oauth-callback-boot.js' });
  return { order, resultEl, renderedTexts };
}

describe('oauth-callback-boot', () => {
  it('先 hydrate locale 再 applyDom，最后才处理回调', async () => {
    const { order } = runBoot();
    await waitFor(order, 'handle');
    assert.deepEqual(order, ['hydrate', 'applyDom', 'handle']);
  });

  it('hydrate 失败不阻断回调处理', async () => {
    const order = [];
    const context = {
      console,
      document: { querySelector: () => null, getElementById: () => null },
      location: { search: '' },
      chrome: { storage: { local: { get: () => Promise.resolve({}) } } },
      AidevpushI18n: {
        hydrateFromStorage: () => {
          order.push('hydrate');
          return Promise.reject(new Error('storage down'));
        },
        applyDom: () => order.push('applyDom'),
      },
      OAuthCallback: {
        SESSION_KEY: 'oauthPkceSession',
        handleCallback: () => {
          order.push('handle');
          return Promise.resolve({ status: 'ok', message: 'ok' });
        },
      },
      tx: (key) => key,
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(BOOT_SRC, context, { filename: 'oauth-callback-boot.js' });
    await waitFor(order, 'handle');
    assert.deepEqual(order, ['hydrate', 'applyDom', 'handle']);
  });

  it('回调抛错时以 tx() 渲染本地化兜底文案', async () => {
    const { resultEl } = runBoot({ failure: new Error('boom') });
    for (let i = 0; i < 50 && !resultEl.textContent; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(resultEl.textContent, 'oauthCallbackBootException:boom');
  });

  it('oauth-callback.html 在 boot 脚本之前加载完整 i18n 链', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'oauth-callback.html'), 'utf8');
    const at = (rel) => html.indexOf(rel);
    for (const rel of ['lib/i18n.js', 'lib/i18n-messages.js', 'lib/i18n-ui-messages.js', 'lib/i18n-tx.js']) {
      assert.ok(at(rel) > 0, `oauth-callback.html 缺少 ${rel}`);
    }
    assert.ok(at('lib/i18n-tx.js') < at('lib/oauth-callback.js'), 'i18n-tx.js 须先于 oauth-callback.js');
    assert.ok(at('lib/i18n-tx.js') < at('lib/oauth-callback-boot.js'), 'i18n-tx.js 须先于 oauth-callback-boot.js');
    assert.ok(at('lib/plugin-brand.js') > 0, '缺少 plugin-brand.js（{brand} 插值来源）');
  });
});
