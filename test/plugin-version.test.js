'use strict';

/**
 * Popup 插件版本号：从 chrome.runtime.getManifest() 读取，格式化为 v{version}。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { readPopupBundle } = require('./helpers/popupBundle.js');

const {
  readExtensionVersion,
  formatExtensionVersionText,
  applyExtensionVersionToElement,
  isBetaInstallType,
  compareExtensionVersions,
  parseGithubLatestRelease,
  decideBetaReleaseNotice,
  refreshExtensionVersionPresentation,
  LATEST_RELEASE_URL,
} = require('../lib/plugin-version.js');

const ZIP_192 = 'https://github.com/task2money/taskChromePlugin/releases/download/v1.8.92/task-chrome-plugin-v1.8.92.zip';

function versionT(key, params) {
  const table = {
    popupVersionLabel: 'v{version}',
    popupVersionAria: '插件版本 {version}',
    popupVersionBetaLabel: 'v{version} Beta',
    popupVersionBetaAria: '插件版本 {version}，开发者模式 Beta',
    popupVersionUpdate: '有新版本 v{latest} 可下载',
    popupVersionUpdateAria: '下载插件新版本 v{latest}',
  };
  const raw = table[key] || key;
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => (params && params[k] != null ? String(params[k]) : `{${k}}`));
}

function releasePayload(version, downloadUrl) {
  return {
    tag_name: `v${version}`,
    assets: [{
      name: `task-chrome-plugin-v${version}.zip`,
      browser_download_url: downloadUrl || `https://github.com/task2money/taskChromePlugin/releases/download/v${version}/task-chrome-plugin-v${version}.zip`,
    }],
  };
}

function makeVersionHost() {
  const links = [];
  const parent = {
    querySelector(sel) {
      if (sel === '[data-plugin-version-update]') return links[0] || null;
      return null;
    },
  };
  const el = {
    hidden: false,
    textContent: '',
    parentElement: parent,
    setAttribute() {},
    ownerDocument: {
      createElement() {
        return {
          dataset: {},
          textContent: '',
          className: '',
          href: '',
          target: '',
          rel: '',
          ariaLabel: '',
          setAttribute(k, v) {
            if (k === 'aria-label') this.ariaLabel = v;
          },
          remove() {
            const i = links.indexOf(this);
            if (i >= 0) links.splice(i, 1);
          },
        };
      },
    },
    insertAdjacentElement(_where, node) {
      links.splice(0, links.length, node);
    },
  };
  return { el, links };
}

function memStorage(seed) {
  const box = Object.assign({}, seed);
  return {
    async get(key) { return box[key]; },
    async set(key, value) { box[key] = value; },
    box,
  };
}

describe('readExtensionVersion', () => {
  it('从 getManifest().version 读取', () => {
    const chromeApi = { runtime: { getManifest: () => ({ version: '1.8.54' }) } };
    assert.equal(readExtensionVersion(chromeApi), '1.8.54');
  });

  it('getManifest 缺失或抛错时返回空串', () => {
    assert.equal(readExtensionVersion({}), '');
    assert.equal(readExtensionVersion({ runtime: { getManifest: () => { throw new Error('no'); } } }), '');
  });
});

describe('formatExtensionVersionText', () => {
  it('用 i18n 模板输出 v{version}', () => {
    const t = (key, params) => (key === 'popupVersionLabel' ? `v${params.version}` : key);
    assert.equal(formatExtensionVersionText('1.8.54', t), 'v1.8.54');
  });

  it('空版本返回空串', () => {
    assert.equal(formatExtensionVersionText('', () => 'v{version}'), '');
  });
});

describe('applyExtensionVersionToElement', () => {
  it('写入可见文案；无版本则 hidden', () => {
    const el = { hidden: false, textContent: '' };
    const t = (key, params) => `v${params.version}`;
    assert.equal(
      applyExtensionVersionToElement(el, { runtime: { getManifest: () => ({ version: '1.8.54' }) } }, t),
      true,
    );
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, 'v1.8.54');

    const empty = { hidden: false, textContent: 'x' };
    assert.equal(applyExtensionVersionToElement(empty, {}, t), false);
    assert.equal(empty.hidden, true);
    assert.equal(empty.textContent, '');
  });
});

describe('Popup 源码契约', () => {
  it('popup.html 有 #popupVersion，并加载 plugin-version.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    assert.match(html, /id="popupVersion"/);
    assert.match(html, /src="\.\.\/lib\/plugin-version\.js"/);
  });

  it('init 调用 renderPopupVersion；bundle 使用 PluginVersion', () => {
    const js = readPopupBundle();
    assert.match(js, /function renderPopupVersion/);
    assert.match(js, /renderPopupVersion\(\)/);
    assert.match(js, /globalThis\.PluginVersion/);
    assert.match(js, /applyExtensionVersionToElement/);
  });

  it('中英 i18n 含 popupVersionLabel / popupVersionAria', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'i18n-messages.js'), 'utf8');
    assert.match(src, /popupVersionLabel:\s*'v\{version\}'/);
    assert.match(src, /popupVersionAria:\s*'插件版本 \{version\}'/);
    assert.match(src, /popupVersionAria:\s*'Extension version \{version\}'/);
  });

  it('popup 与 panel 加载 Beta 文案，并在渲染后检查最新 Release', () => {
    const popup = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    const panel = fs.readFileSync(path.join(ROOT, 'panel', 'panel.html'), 'utf8');
    for (const html of [popup, panel]) {
      const i18nAt = html.indexOf('src="../lib/i18n-version-messages.js"');
      const verAt = html.indexOf('src="../lib/plugin-version.js"');
      assert.ok(i18nAt > -1, 'missing i18n-version-messages.js');
      assert.ok(verAt > i18nAt, 'version messages must load before plugin-version.js');
      assert.match(html, /href="\.\.\/lib\/plugin-version\.css"/);
    }
    const popupJs = readPopupBundle();
    assert.match(popupJs, /refreshExtensionVersionPresentation/);
    const panelJs = fs.readFileSync(path.join(ROOT, 'panel', 'panel.js'), 'utf8');
    assert.match(panelJs, /refreshExtensionVersionPresentation/);
    const messages = fs.readFileSync(path.join(ROOT, 'lib', 'i18n-version-messages.js'), 'utf8');
    assert.match(messages, /popupVersionBetaLabel:\s*'v\{version\} Beta'/);
    assert.match(messages, /popupVersionUpdate:\s*'有新版本 v\{latest\} 可下载'/);
    assert.match(messages, /popupVersionUpdate:\s*'Newer version v\{latest\} is available to download'/);
  });
});

describe('Beta 安装与 Release 比较', () => {
  it('仅 development（开发者模式加载未打包扩展）视为 Beta', () => {
    assert.equal(isBetaInstallType('development'), true);
    for (const kind of ['normal', 'sideload', 'admin', 'other', '', null]) {
      assert.equal(isBetaInstallType(kind), false);
    }
  });

  it('按整数段比较版本，本地更旧才提示', () => {
    assert.equal(compareExtensionVersions('1.8.90', '1.8.92'), -1);
    assert.equal(compareExtensionVersions('1.8.9', '1.8.91'), -1);
    assert.equal(compareExtensionVersions('1.8.92', '1.8.92'), 0);
    assert.equal(compareExtensionVersions('1.10.0', '1.9.9'), 1);
    assert.equal(compareExtensionVersions('v1.8.91', '1.8.92'), -1);
    assert.equal(compareExtensionVersions('nope', '1.8.92'), null);
  });

  it('只接受本仓库 Release zip 下载地址', () => {
    const ok = parseGithubLatestRelease(releasePayload('1.8.92', ZIP_192));
    assert.deepEqual(ok, { version: '1.8.92', downloadUrl: ZIP_192 });
    assert.equal(parseGithubLatestRelease({
      tag_name: 'v1.8.92',
      assets: [{ name: 'evil.zip', browser_download_url: 'https://evil.example/task.zip' }],
    }), null);
    assert.equal(parseGithubLatestRelease({
      tag_name: 'v1.8.92',
      assets: [{
        name: 'x.zip',
        browser_download_url: 'https://github.com/other/repo/releases/download/v1/x.zip',
      }],
    }), null);
    assert.equal(parseGithubLatestRelease({ tag_name: 'v1.8.92', assets: [] }), null);
  });

  it('Beta 且远程更新时给出下载；商店安装或已最新则不提示', () => {
    const release = { version: '1.8.92', downloadUrl: ZIP_192 };
    assert.deepEqual(
      decideBetaReleaseNotice({ installType: 'development', localVersion: '1.8.90', release }),
      { beta: true, update: { latest: '1.8.92', downloadUrl: ZIP_192 } },
    );
    assert.deepEqual(
      decideBetaReleaseNotice({ installType: 'normal', localVersion: '1.8.90', release }),
      { beta: false, update: null },
    );
    assert.deepEqual(
      decideBetaReleaseNotice({ installType: 'development', localVersion: '1.8.92', release }),
      { beta: true, update: null },
    );
    assert.deepEqual(
      decideBetaReleaseNotice({ installType: 'development', localVersion: '1.8.93', release }),
      { beta: true, update: null },
    );
  });
});

describe('refreshExtensionVersionPresentation', () => {
  it('开发者模式且落后于 Release 时显示 Beta 与下载链接', async () => {
    const { el, links } = makeVersionHost();
    let fetches = 0;
    const storage = memStorage();
    await refreshExtensionVersionPresentation(el, {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'development' }) },
    }, versionT, {
      storage,
      now: () => 1_000,
      fetchImpl: async (url) => {
        fetches += 1;
        assert.equal(url, LATEST_RELEASE_URL);
        return { ok: true, json: async () => releasePayload('1.8.92', ZIP_192) };
      },
    });
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, 'v1.8.90 Beta');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, ZIP_192);
    assert.equal(links[0].textContent, '有新版本 v1.8.92 可下载');
    assert.equal(links[0].target, '_blank');
    assert.match(links[0].rel, /noopener/);
    assert.equal(links[0].dataset.pluginVersionUpdate, '1');

    await refreshExtensionVersionPresentation(el, {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'development' }) },
    }, versionT, {
      storage,
      now: () => 1_000 + 60_000,
      fetchImpl: async () => { fetches += 1; throw new Error('should use cache'); },
    });
    assert.equal(fetches, 1);
    assert.equal(links[0].href, ZIP_192);
  });

  it('非开发者模式不请求 GitHub，也不标 Beta', async () => {
    const { el, links } = makeVersionHost();
    await refreshExtensionVersionPresentation(el, {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'normal' }) },
    }, versionT, {
      fetchImpl: async () => { throw new Error('must not fetch'); },
    });
    assert.equal(el.textContent, 'v1.8.90');
    assert.equal(links.length, 0);
  });

  it('无法判断安装类型或 Release 失败时不编造更新提示', async () => {
    const { el, links } = makeVersionHost();
    await refreshExtensionVersionPresentation(el, {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => { throw new Error('no management'); } },
    }, versionT, {
      fetchImpl: async () => { throw new Error('must not fetch'); },
    });
    assert.equal(el.textContent, 'v1.8.90');
    assert.equal(links.length, 0);

    const beta = makeVersionHost();
    await refreshExtensionVersionPresentation(beta.el, {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'development' }) },
    }, versionT, {
      now: () => 5_000,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });
    assert.equal(beta.el.textContent, 'v1.8.90 Beta');
    assert.equal(beta.links.length, 0);
  });
});
