/**
 * chrome:// 页无法用裸 <a href>，须经 tabs.create（与快捷键设置入口同模式）。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOpenChromeUrl() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'open-chrome-url.js'),
    'utf8',
  );
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.OpenChromeUrl;
}

describe('OpenChromeUrl', () => {
  it('exports on-device-internals constant', () => {
    const api = loadOpenChromeUrl();
    assert.equal(api.ON_DEVICE_INTERNALS, 'chrome://on-device-internals');
  });

  it('opens url via tabs.create in a new tab', async () => {
    const api = loadOpenChromeUrl();
    const calls = [];
    const tabsApi = {
      create(opts) {
        calls.push(opts);
        return Promise.resolve({ id: 42, url: opts.url });
      },
    };
    const tab = await api.openChromeUrl(api.ON_DEVICE_INTERNALS, tabsApi);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'chrome://on-device-internals');
    assert.equal(tab.id, 42);
  });

  it('rejects when tabs.create is unavailable', async () => {
    const api = loadOpenChromeUrl();
    await assert.rejects(
      () => api.openChromeUrl('chrome://on-device-internals', null),
      /tabs\.create unavailable/,
    );
  });
});

describe('sidepanel internals link markup', () => {
  it('renders clickable on-device-internals link', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'sidepanel', 'sidepanel.html'),
      'utf8',
    );
    assert.match(html, /id="spBuiltinInternalsLink"/);
    assert.match(html, /chrome:\/\/on-device-internals/);
    assert.doesNotMatch(html, /扩展无法直接打开该页/);
  });
});
