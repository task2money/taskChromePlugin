'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

describe('content-boot-gate idempotent inject', () => {
  it('manifest lists content-boot-gate first in each content_scripts entry', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
    );
    for (const entry of manifest.content_scripts) {
      assert.equal(entry.js[0], 'lib/content-boot-gate.js');
    }
  });

  it('second gate run sets skip without throwing', () => {
    const gateSrc = fs.readFileSync(
      path.join(root, 'lib/content-boot-gate.js'),
      'utf8',
    );
    const sandbox = { globalThis: {} };
    vm.runInNewContext(gateSrc, sandbox);
    assert.equal(sandbox.globalThis.__taskpluginContentBoot.skip, false);
    vm.runInNewContext(gateSrc, sandbox);
    assert.equal(sandbox.globalThis.__taskpluginContentBoot.skip, true);
  });

  it('storage.js reuses globalThis.Storage when skip flag set', () => {
    const storageSrc = fs.readFileSync(
      path.join(root, 'lib/storage.js'),
      'utf8',
    );
    assert.match(storageSrc, /globalThis\.Storage/);
    const sandbox = {
      globalThis: {
        __taskpluginContentBoot: { skip: true },
        Storage: { reused: true },
      },
      chrome: { storage: { local: {}, session: {} } },
    };
    assert.doesNotThrow(() => vm.runInNewContext(storageSrc, sandbox));
    assert.equal(sandbox.Storage.reused, true);
  });

  it('content.js skips runtime listener when boot skip set', () => {
    const contentSrc = fs.readFileSync(
      path.join(root, 'content/content.js'),
      'utf8',
    );
    assert.match(contentSrc, /__taskpluginContentBoot\?\.skip/);
  });
});
