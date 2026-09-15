'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

const MANIFEST_LIBS = (() => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
  );
  return manifest.content_scripts[0].js.filter((rel) => rel.startsWith('lib/'));
})();

/**
 * 宽松沙箱：lib/*.js 只在函数体内触达 chrome/document，
 * 加载期求值只需一个属性自返回的桩。
 */
function makeLibSandbox() {
  const stub = new Proxy(function stubFn() { return stub; }, {
    get: (_t, prop) => (prop === 'then' ? undefined : stub),
    apply: () => stub,
    set: () => true,
  });
  const sandbox = {
    console,
    chrome: stub,
    document: stub,
    navigator: stub,
    location: stub,
    history: stub,
    setTimeout: stub,
    clearTimeout: stub,
    setInterval: stub,
    clearInterval: stub,
    requestAnimationFrame: stub,
    cancelAnimationFrame: stub,
    fetch: stub,
    URL,
    URLSearchParams,
    Date,
    Math,
    JSON,
    Promise,
    MutationObserver: function MutationObserver() {},
    CustomEvent: function CustomEvent() {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

function runLib(rel, sandbox) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInNewContext(src, sandbox, { filename: rel });
}

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

  it('every manifest lib/*.js is wrapped in the boot gate', () => {
    assert.ok(MANIFEST_LIBS.length > 1, 'manifest 应列出多个 lib 文件');
    for (const rel of MANIFEST_LIBS) {
      if (rel === 'lib/content-boot-gate.js') continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.match(
        src,
        /^if \(!globalThis\.__taskpluginContentBoot\?\.skip\) \{$/m,
        `${rel} 缺少 content-boot skip 门闩包裹`,
      );
    }
  });

  it('整包二次注入不抛词法重声明错误，且 gate 转入 skip', () => {
    const sandbox = makeLibSandbox();
    for (let pass = 0; pass < 2; pass += 1) {
      for (const rel of MANIFEST_LIBS) {
        assert.doesNotThrow(
          () => runLib(rel, sandbox),
          `${rel} 第 ${pass + 1} 次注入抛错`,
        );
      }
    }
    assert.equal(
      sandbox.__taskpluginContentBoot.skip,
      true,
      '第二次注入后 gate 应处于 skip 态',
    );
  });

  it('gate skip 后重复注入为 no-op（既有全局导出保持同一引用）', () => {
    const sandbox = makeLibSandbox();
    for (const rel of MANIFEST_LIBS) runLib(rel, sandbox);
    const storage = sandbox.Storage;
    const pageContext = sandbox.PageContext;
    assert.equal(typeof storage, 'object');
    assert.equal(typeof pageContext, 'object');
    for (const rel of MANIFEST_LIBS) {
      assert.doesNotThrow(() => runLib(rel, sandbox), `${rel} skip 后仍抛错`);
    }
    assert.equal(sandbox.Storage, storage, 'skip 后不得重建 Storage');
    assert.equal(sandbox.PageContext, pageContext, 'skip 后不得重建 PageContext');
  });

  it('content.js skips runtime listener when boot skip set', () => {
    const contentSrc = fs.readFileSync(
      path.join(root, 'content/content.js'),
      'utf8',
    );
    assert.match(contentSrc, /__taskpluginContentBoot\?\.skip/);
  });
});
