/**
 * chrome:// 页无法用裸 <a href>，须经 tabs.create（popup 快捷键 / Beta 扩展页 / internals 共用）。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadOpenChromeUrl() {
  const src = fs.readFileSync(
    path.join(ROOT, 'lib', 'open-chrome-url.js'),
    'utf8',
  );
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.OpenChromeUrl;
}

describe('OpenChromeUrl', () => {
  it('exports chrome:// URL constants', () => {
    const api = loadOpenChromeUrl();
    assert.equal(api.ON_DEVICE_INTERNALS, 'chrome://on-device-internals');
    assert.equal(api.EXTENSIONS_SHORTCUTS, 'chrome://extensions/shortcuts');
    assert.equal(api.EXTENSIONS_PAGE, 'chrome://extensions/');
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

  it('opens extensions shortcuts url via tabs.create', async () => {
    const api = loadOpenChromeUrl();
    const calls = [];
    const tabsApi = {
      create(opts) {
        calls.push(opts);
        return Promise.resolve({ id: 7, url: opts.url });
      },
    };
    await api.openChromeUrl(api.EXTENSIONS_SHORTCUTS, tabsApi);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'chrome://extensions/shortcuts');
  });

  it('rejects when tabs.create is unavailable', async () => {
    const api = loadOpenChromeUrl();
    await assert.rejects(
      () => api.openChromeUrl('chrome://on-device-internals', null),
      /tabs\.create unavailable/,
    );
  });
});

describe('sidepanel / popup load OpenChromeUrl', () => {
  it('renders clickable on-device-internals link and loads helper', () => {
    const html = fs.readFileSync(
      path.join(ROOT, 'sidepanel', 'sidepanel.html'),
      'utf8',
    );
    assert.match(html, /id="spBuiltinInternalsLink"/);
    assert.match(html, /chrome:\/\/on-device-internals/);
    assert.match(html, /src="\.\.\/lib\/open-chrome-url\.js"/);
    assert.doesNotMatch(html, /扩展无法直接打开该页/);
  });

  it('popup loads open-chrome-url before popup.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    const openAt = html.indexOf('src="../lib/open-chrome-url.js"');
    const popupAt = html.indexOf('src="popup.js"');
    assert.ok(openAt > -1, 'popup.html must load open-chrome-url.js');
    assert.ok(popupAt > openAt, 'open-chrome-url.js must load before popup.js');
  });
});
