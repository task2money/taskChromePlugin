'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

  // Constraint 44: a helper-created profile must not outlive the run.
  // Regression: e2e runs stranded one /tmp/taskplugin-ext-e2e-* dir each
  // (194 accumulated) because nothing ever removed the mkdtemp result.
  it('removes the helper-created profile when the context closes', async () => {
    let created;
    const fakeChromium = {
      async launchPersistentContext(userDataDir) {
        created = userDataDir;
        return { close: async () => {} };
      },
    };
    const ctx = await launchExtensionContext(fakeChromium, '/tmp/fake-ext', {
      headless: true,
    });
    assert.ok(fs.existsSync(created), 'profile exists while the context is open');
    await ctx.close();
    assert.equal(fs.existsSync(created), false, 'profile is gone after close');
  });

  it('removes the created profile when the launch itself fails', async () => {
    let created;
    const fakeChromium = {
      async launchPersistentContext(userDataDir) {
        created = userDataDir;
        throw new Error('extension load failed');
      },
    };
    await assert.rejects(
      () => launchExtensionContext(fakeChromium, '/tmp/fake-ext', { headless: true }),
      /extension load failed/,
    );
    assert.equal(fs.existsSync(created), false, 'failed launch must not strand a profile');
  });

  it('leaves a caller-supplied userDataDir alone', async () => {
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'caller-owned-ext-'));
    try {
      const fakeChromium = {
        async launchPersistentContext() {
          return { close: async () => {} };
        },
      };
      const ctx = await launchExtensionContext(fakeChromium, '/tmp/fake-ext', {
        userDataDir: own,
        headless: true,
      });
      await ctx.close();
      assert.ok(fs.existsSync(own), 'caller-owned dir must not be deleted by the helper');
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }
  });
});
