'use strict';

/**
 * 快速创建任务旁的语言下拉必须把所选 locale 写进浮窗静态文案。
 * 浮窗 HTML 在挂载时用 t() 烘焙当前语言；切换后只能靠 data-i18n + applyDom 重绘。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadI18n() {
  delete require.cache[require.resolve('../lib/i18n.js')];
  delete require.cache[require.resolve('../lib/i18n-messages.js')];
  delete require.cache[require.resolve('../lib/i18n-ui-messages.js')];
  delete require.cache[require.resolve('../lib/i18n-locale-messages.js')];
  delete require.cache[require.resolve('../lib/float-panel-markup.js')];
  const i18n = require('../lib/i18n.js');
  require('../lib/i18n-messages.js');
  require('../lib/i18n-ui-messages.js');
  require('../lib/i18n-locale-messages.js');
  const { html } = require('../lib/float-panel-markup.js');
  return { i18n, html };
}

function stubRoot(markup) {
  const buckets = {
    '[data-i18n]': [],
    '[data-i18n-html]': [],
    '[data-i18n-placeholder]': [],
    '[data-i18n-title]': [],
    '[data-i18n-aria-label]': [],
  };
  const tagRe = /<([a-z0-9-]+)([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(markup))) {
    const attrs = {};
    const attrRe = /([\w:-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2];
    const el = {
      attrs,
      textContent: '',
      getAttribute(name) {
        return this.attrs[name] || null;
      },
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
    };
    for (const sel of Object.keys(buckets)) {
      const name = sel.slice(1, -1);
      if (attrs[name]) buckets[sel].push(el);
    }
  }
  return {
    querySelectorAll(sel) {
      return buckets[sel] || [];
    },
    buckets,
  };
}

function textFor(root, key) {
  const el = root.buckets['[data-i18n]'].find((node) => node.getAttribute('data-i18n') === key);
  assert.ok(el, `missing data-i18n=${key}`);
  return el.textContent;
}

describe('float-panel-markup locale', () => {
  it('content script loads locale messages before the float markup is built', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts[0].js;
    const msg = js.indexOf('lib/i18n-locale-messages.js');
    const markup = js.indexOf('lib/float-panel-markup.js');
    assert.ok(msg >= 0, 'content_scripts 须加载 i18n-locale-messages.js');
    assert.ok(markup > msg, 'locale 文案表必须先于 float-panel-markup.js');
  });

  it('switching locale rewrites the quick-create title and option labels', () => {
    const { i18n, html } = loadI18n();
    i18n.setLocale('zh-CN');
    const baked = html('form');
    assert.match(baked, /快速创建任务/);
    assert.match(baked, /data-i18n="floatQuickCreate"/);
    assert.match(baked, /data-i18n="pluginLocaleZh"/);
    assert.match(baked, /data-i18n="pluginLocaleEn"/);

    const root = stubRoot(baked);
    i18n.setLocale('en');
    i18n.applyDom(root);
    assert.equal(textFor(root, 'floatQuickCreate'), 'Quick create task');
    assert.equal(textFor(root, 'pluginLocaleZh'), 'Chinese');
    assert.equal(textFor(root, 'pluginLocaleEn'), 'English');
    assert.equal(textFor(root, 'floatWorkspace'), 'Workspace');
    assert.equal(textFor(root, 'floatCreateTask'), '✅ Create task');
  });
});
