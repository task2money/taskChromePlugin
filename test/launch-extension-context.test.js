'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  resolveCachedChromiumExecutable,
  launchExtensionContext,
} = require('../e2e/helpers/launchExtensionContext.js');

describe('launchExtensionContext helper (OPT-20260918-027)', () => {
  it('exports resolveCachedChromiumExecutable returning string|null', () => {
    const exe = resolveCachedChromiumExecutable();
    assert.ok(exe === null || (typeof exe === 'string' && path.isAbsolute(exe)));
    if (exe) assert.ok(exe.includes('chrome'));
  });

  it('launchExtensionContext prefers executablePath over channel when cache hit', async () => {
    const calls = [];
    const fakeChromium = {
      async launchPersistentContext(userDataDir, options) {
        calls.push({ userDataDir, options });
        return { close: async () => {} };
      },
    };
    const exe = resolveCachedChromiumExecutable();
    await launchExtensionContext(fakeChromium, '/tmp/fake-ext', { headless: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headless, true);
    assert.ok(calls[0].options.args.some((a) => a.includes('load-extension=/tmp/fake-ext')));
    assert.ok(calls[0].options.args.includes('--disable-gpu'));
    assert.ok(String(calls[0].userDataDir).includes('taskplugin-ext-e2e-'));
    if (exe) {
      assert.equal(calls[0].options.executablePath, exe);
      assert.equal(calls[0].options.channel, undefined);
    } else {
      assert.equal(calls[0].options.channel, 'chromium');
    }
  });
});
