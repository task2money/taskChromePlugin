'use strict';

/**
 * OPT-20260921-023: DevTools 面板顶栏展示插件版本号，与 Popup 同源（lib/plugin-version.js）。
 * 排障时无需再打开 Popup 核对 GitHub Release 版本。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const {
  applyExtensionVersionToElement,
} = require('../lib/plugin-version.js');

/** DevTools 面板主入口源码（版本号渲染所在的 orchestrator）。 */
function readPanelBundle() {
  return fs.readFileSync(path.join(ROOT, 'panel', 'panel.js'), 'utf8');
}

describe('DevTools 面板顶栏版本号', () => {
  it('panel.html 有 #panelVersion 且加载 plugin-version.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'panel', 'panel.html'), 'utf8');
    assert.match(html, /id="panelVersion"/);
    assert.match(html, /src="\.\.\/lib\/plugin-version\.js"/);
  });

  it('panel.html 中 plugin-version.js 先于 panel.js 加载', () => {
    const html = fs.readFileSync(path.join(ROOT, 'panel', 'panel.html'), 'utf8');
    const lib = html.indexOf('src="../lib/plugin-version.js"');
    const main = html.indexOf('src="panel.js"');
    assert.ok(lib > -1, 'panel.html 未加载 plugin-version.js');
    assert.ok(main > -1, 'panel.html 未加载 panel.js');
    assert.ok(lib < main, 'plugin-version.js 必须在 panel.js 之前加载');
  });

  it('init 调用 renderPanelVersion，并使用 PluginVersion helper', () => {
    const js = readPanelBundle();
    assert.match(js, /function renderPanelVersion/);
    assert.match(js, /renderPanelVersion\(\)/);
    assert.match(js, /globalThis\.PluginVersion/);
    assert.match(js, /applyExtensionVersionToElement/);
    assert.match(js, /'#panelVersion'/);
  });

  it('写入可见文案；无版本则 hidden（复用 Popup 相同 helper 语义）', () => {
    const el = { hidden: false, textContent: '' };
    const t = (key, params) => (key === 'popupVersionLabel' ? `v${params.version}` : key);
    assert.equal(
      applyExtensionVersionToElement(
        el,
        { runtime: { getManifest: () => ({ version: '1.9.0' }) } },
        t,
      ),
      true,
    );
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, 'v1.9.0');

    const empty = { hidden: false, textContent: 'x' };
    assert.equal(applyExtensionVersionToElement(empty, {}, t), false);
    assert.equal(empty.hidden, true);
    assert.equal(empty.textContent, '');
  });
});
