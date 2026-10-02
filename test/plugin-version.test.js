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
  bindExtensionVersionDoubleClick,
  downloadBetaUpdateAndOpenExtensions,
  EXTENSIONS_PAGE_URL,
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
    popupVersionChecking: '正在检测版本…',
    popupVersionUpToDate: '已是最新',
    popupVersionCheckFailed: '版本检测失败',
    popupVersionCheckHint: '双击检测新版本',
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
    attrs: {},
    parentElement: parent,
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
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
          listeners: {},
          addEventListener(type, fn) {
            this.listeners[type] = this.listeners[type] || [];
            this.listeners[type].push(fn);
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
    assert.match(popupJs, /bindExtensionVersionDoubleClick/);
    assert.match(panelJs, /bindExtensionVersionDoubleClick/);
    const messages = fs.readFileSync(path.join(ROOT, 'lib', 'i18n-version-messages.js'), 'utf8');
    assert.match(messages, /popupVersionBetaLabel:\s*'v\{version\} Beta'/);
    assert.match(messages, /popupVersionUpdate:\s*'有新版本 v\{latest\} 可下载'/);
    assert.match(messages, /popupVersionUpdate:\s*'Newer version v\{latest\} is available to download'/);
    assert.match(messages, /popupVersionChecking:\s*'正在检测版本…'/);
    assert.match(messages, /popupVersionChecking:\s*'Checking for updates…'/);
    assert.match(messages, /popupVersionUpToDate:\s*'已是最新'/);
    assert.match(messages, /popupVersionUpToDate:\s*'Up to date'/);
    assert.match(messages, /popupVersionCheckFailed:\s*'版本检测失败'/);
    assert.match(messages, /popupVersionCheckFailed:\s*'Update check failed'/);
    assert.match(messages, /popupVersionCheckHint:\s*'双击检测新版本'/);
    assert.match(messages, /popupVersionCheckHint:\s*'Double-click to check for updates'/);
  });

  it('SW 加载 plugin-version 并处理 downloadBetaUpdate', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
    assert.match(sw, /['"]\.\.\/lib\/plugin-version\.js['"]/);
    assert.match(sw, /['"]\.\.\/lib\/plugin-version-download\.js['"]/);
    const verAt = sw.indexOf('../lib/plugin-version.js');
    const dlAt = sw.indexOf('../lib/plugin-version-download.js');
    assert.ok(verAt > -1 && dlAt > verAt, 'download script must load after plugin-version');
    const session = fs.readFileSync(path.join(ROOT, 'background', 'sw-messages-session.js'), 'utf8');
    assert.match(session, /case 'downloadBetaUpdate'/);
    assert.match(session, /downloadBetaUpdateAndOpenExtensions/);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    assert.ok(manifest.permissions.includes('downloads'));
    for (const name of ['popup', 'panel']) {
      const html = fs.readFileSync(path.join(ROOT, name, `${name}.html`), 'utf8');
      const pv = html.indexOf('src="../lib/plugin-version.js"');
      const d = html.indexOf('src="../lib/plugin-version-download.js"');
      assert.ok(pv > -1 && d > pv, `${name}.html must load download after plugin-version`);
    }
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
    assert.equal(el.hidden, true);
    assert.equal(el.textContent, '');
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
    assert.equal(el.hidden, true);
    assert.equal(el.textContent, '');
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

  it('force 绕过缓存重新请求，商店安装也会对照 Release', async () => {
    const { el, links } = makeVersionHost();
    let fetches = 0;
    const storage = memStorage();
    const chromeApi = {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'normal' }) },
    };
    const deps = {
      storage,
      now: () => 1_000,
      fetchImpl: async () => {
        fetches += 1;
        return { ok: true, json: async () => releasePayload('1.8.92', ZIP_192) };
      },
    };
    await refreshExtensionVersionPresentation(el, chromeApi, versionT, deps);
    assert.equal(fetches, 0);

    let checkingText = '';
    deps.now = () => 2_000;
    deps.fetchImpl = async () => {
      fetches += 1;
      checkingText = el.textContent;
      return { ok: true, json: async () => releasePayload('1.8.92', ZIP_192) };
    };
    const again = await refreshExtensionVersionPresentation(el, chromeApi, versionT, {
      ...deps,
      force: true,
    });
    assert.equal(fetches, 1);
    assert.equal(checkingText, '正在检测版本…');
    assert.equal(el.hidden, true);
    assert.equal(links.length, 1);
    assert.equal(links[0].href, ZIP_192);
    assert.equal(again.update, true);
    assert.equal(el.attrs && el.attrs['aria-busy'], undefined);
  });

  it('force 且已是最新或请求失败时在版本号后标出结果', async () => {
    const current = makeVersionHost();
    await refreshExtensionVersionPresentation(current.el, {
      runtime: { getManifest: () => ({ version: '1.8.92' }) },
      management: { getSelf: async () => ({ installType: 'development' }) },
    }, versionT, {
      now: () => 3_000,
      force: true,
      fetchImpl: async () => ({ ok: true, json: async () => releasePayload('1.8.92', ZIP_192) }),
    });
    assert.equal(current.links.length, 0);
    assert.equal(current.el.hidden, false);
    assert.equal(current.el.textContent, 'v1.8.92 Beta · 已是最新');

    const failed = makeVersionHost();
    const storage = memStorage({
      'aidevpush.betaReleaseCheck': {
        checkedAt: 1,
        ok: true,
        release: { version: '1.9.0', downloadUrl: ZIP_192 },
      },
    });
    await refreshExtensionVersionPresentation(failed.el, {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'development' }) },
    }, versionT, {
      storage,
      now: () => 4_000,
      force: true,
      fetchImpl: async () => { throw new Error('offline'); },
    });
    assert.equal(failed.links.length, 0);
    assert.equal(failed.el.textContent, 'v1.8.90 Beta · 版本检测失败');
  });
});

describe('bindExtensionVersionDoubleClick', () => {
  it('只有双击才检测；检测未完成时再次双击不重复请求', async () => {
    let fetches = 0;
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const listeners = {};
    const { el, links } = makeVersionHost();
    el.addEventListener = (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    };
    el.setAttribute = (k, v) => {
      el.attrs = el.attrs || {};
      el.attrs[k] = v;
    };
    el.removeAttribute = (k) => {
      if (el.attrs) delete el.attrs[k];
    };
    const chromeApi = {
      runtime: { getManifest: () => ({ version: '1.8.90' }) },
      management: { getSelf: async () => ({ installType: 'development' }) },
    };
    bindExtensionVersionDoubleClick(el, chromeApi, versionT, {
      now: () => 8_000,
      fetchImpl: async () => {
        fetches += 1;
        await gate;
        return { ok: true, json: async () => releasePayload('1.8.92', ZIP_192) };
      },
    });
    assert.equal(listeners.click, undefined);
    assert.equal(el.attrs.title, '双击检测新版本');
    const first = listeners.dblclick[0]({ preventDefault() {} });
    const second = listeners.dblclick[0]({ preventDefault() {} });
    releaseGate();
    await first;
    await second;
    assert.equal(fetches, 1);
    assert.equal(links.length, 1);
  });

  it('下载链接上双击只再检测，不打开新标签', async () => {
    const { el, links } = makeVersionHost();
    let fetches = 0;
    const opened = [];
    const messages = [];
    const chromeApi = {
      runtime: {
        getManifest: () => ({ version: '1.8.90' }),
        sendMessage(msg) { messages.push(msg); },
      },
      management: { getSelf: async () => ({ installType: 'development' }) },
      tabs: { create(info) { opened.push(info.url); } },
    };
    await refreshExtensionVersionPresentation(el, chromeApi, versionT, {
      now: () => 9_000,
      fetchImpl: async () => {
        fetches += 1;
        return { ok: true, json: async () => releasePayload('1.8.92', ZIP_192) };
      },
    });
    assert.equal(links.length, 1);
    const link = links[0];
    const click = { detail: 1, prevented: false, preventDefault() { this.prevented = true; } };
    link.listeners.click[0](click);
    const dbl = { detail: 2, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    const again = link.listeners.dblclick[0](dbl);
    assert.equal(click.prevented, true);
    assert.equal(dbl.prevented, true);
    await again;
    assert.equal(fetches, 2);
    assert.equal(opened.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(links.length, 1);
  });

  it('单击新版本链接经 runtime 请求下载，不直接开 zip 标签', async () => {
    const { el, links } = makeVersionHost();
    const messages = [];
    const opened = [];
    const chromeApi = {
      runtime: {
        getManifest: () => ({ version: '1.8.90' }),
        sendMessage(msg) { messages.push(msg); },
      },
      management: { getSelf: async () => ({ installType: 'development' }) },
      tabs: { create(info) { opened.push(info.url); } },
    };
    await refreshExtensionVersionPresentation(el, chromeApi, versionT, {
      now: () => 10_000,
      fetchImpl: async () => ({ ok: true, json: async () => releasePayload('1.8.92', ZIP_192) }),
    });
    const link = links[0];
    link.listeners.click[0]({ detail: 1, preventDefault() {} });
    await new Promise((r) => setTimeout(r, 350));
    assert.deepEqual(messages, [{ action: 'downloadBetaUpdate', url: ZIP_192 }]);
    assert.equal(opened.length, 0);
  });
});

describe('downloadBetaUpdateAndOpenExtensions', () => {
  async function waitFor(predicate, label) {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(label || 'waitFor timeout');
  }

  it('下载完成后才打开 chrome://extensions/', async () => {
    assert.equal(EXTENSIONS_PAGE_URL, 'chrome://extensions/');
    const listeners = [];
    const opened = [];
    const downloads = [];
    const chromeApi = {
      downloads: {
        download(opts) {
          downloads.push(opts);
          return Promise.resolve(77);
        },
        onChanged: {
          addListener(fn) { listeners.push(fn); },
          removeListener(fn) {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      tabs: {
        create(info) { opened.push(info.url); return Promise.resolve({}); },
      },
    };
    const pending = downloadBetaUpdateAndOpenExtensions(chromeApi, ZIP_192);
    await waitFor(() => listeners.length === 1, 'download listener');
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].url, ZIP_192);
    assert.equal(downloads[0].filename, 'task-chrome-plugin-v1.8.92.zip');
    assert.equal(opened.length, 0);
    listeners[0]({ id: 77, state: { current: 'complete' } });
    const result = await pending;
    assert.equal(result, true);
    assert.deepEqual(opened, [EXTENSIONS_PAGE_URL]);
    assert.equal(listeners.length, 0);
  });

  it('下载中断时不打开扩展页；非法 URL 直接拒绝', async () => {
    const opened = [];
    const listeners = [];
    const chromeApi = {
      downloads: {
        download() { return Promise.resolve(9); },
        onChanged: {
          addListener(fn) { listeners.push(fn); },
          removeListener(fn) {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      tabs: { create(info) { opened.push(info.url); } },
    };
    const pending = downloadBetaUpdateAndOpenExtensions(chromeApi, ZIP_192);
    await waitFor(() => listeners.length === 1, 'download listener');
    listeners[0]({ id: 9, state: { current: 'interrupted' } });
    await assert.rejects(pending, /interrupted|download/i);
    assert.equal(opened.length, 0);

    assert.equal(
      await downloadBetaUpdateAndOpenExtensions(chromeApi, 'https://evil.example/x.zip'),
      false,
    );
    assert.equal(opened.length, 0);
  });
});
