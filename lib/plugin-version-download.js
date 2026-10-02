/**
 * Beta 新版本 zip：chrome.downloads 完成后打开 chrome://extensions/。
 * 须在 Service Worker 中执行（popup 关闭后监听器会失效）。
 * 依赖先加载的 PluginVersion（isAllowedDownloadUrl / chromeOr 挂在其上）。
 */
(function (global) {
  'use strict';

  const EXTENSIONS_PAGE_URL = 'chrome://extensions/';

  function chromeOr(chromeApi) {
    if (chromeApi !== undefined) return chromeApi;
    return typeof chrome !== 'undefined' ? chrome : undefined;
  }

  function getAllowedCheck() {
    const pv = global && global.PluginVersion;
    if (pv && typeof pv.isAllowedDownloadUrl === 'function') return pv.isAllowedDownloadUrl;
    return function () { return false; };
  }

  function filenameFromAllowedDownloadUrl(url) {
    if (!getAllowedCheck()(url)) return '';
    try {
      const parts = new URL(String(url)).pathname.split('/');
      const name = parts[parts.length - 1] || '';
      return name.toLowerCase().endsWith('.zip') ? name : '';
    } catch (_) {
      return '';
    }
  }

  function openExtensionsManagementPage(chromeApi) {
    const api = chromeOr(chromeApi);
    const Open = global && global.OpenChromeUrl;
    const url = (Open && Open.EXTENSIONS_PAGE) || EXTENSIONS_PAGE_URL;
    if (Open && typeof Open.openChromeUrl === 'function') {
      return Open.openChromeUrl(url, api && api.tabs);
    }
    const tabs = api && api.tabs;
    if (!tabs || typeof tabs.create !== 'function') {
      return Promise.reject(new Error('tabs.create unavailable'));
    }
    return Promise.resolve(tabs.create({ url }));
  }

  function awaitDownloadComplete(chromeApi, downloadId) {
    const api = chromeOr(chromeApi);
    const downloads = api && api.downloads;
    const onChanged = downloads && downloads.onChanged;
    if (!onChanged || typeof onChanged.addListener !== 'function') {
      return Promise.reject(new Error('downloads.onChanged unavailable'));
    }
    const id = Number(downloadId);
    if (!Number.isFinite(id)) {
      return Promise.reject(new Error('invalid download id'));
    }
    return new Promise(function (resolve, reject) {
      function onDelta(delta) {
        if (!delta || delta.id !== id) return;
        const state = delta.state && delta.state.current;
        if (state === 'complete') {
          if (typeof onChanged.removeListener === 'function') onChanged.removeListener(onDelta);
          resolve(id);
          return;
        }
        if (state === 'interrupted') {
          if (typeof onChanged.removeListener === 'function') onChanged.removeListener(onDelta);
          reject(new Error('download interrupted'));
        }
      }
      onChanged.addListener(onDelta);
    });
  }

  async function startAllowedZipDownload(chromeApi, url) {
    if (!getAllowedCheck()(url)) return null;
    const api = chromeOr(chromeApi);
    const downloads = api && api.downloads;
    if (!downloads || typeof downloads.download !== 'function') {
      throw new Error('downloads.download unavailable');
    }
    const filename = filenameFromAllowedDownloadUrl(url);
    const opts = { url: String(url), saveAs: false };
    if (filename) opts.filename = filename;
    const downloadId = await downloads.download(opts);
    if (api.runtime && api.runtime.lastError) {
      throw new Error(String(api.runtime.lastError.message || 'download failed'));
    }
    if (downloadId == null) throw new Error('download id missing');
    return downloadId;
  }

  async function downloadBetaUpdateAndOpenExtensions(chromeApi, url) {
    if (!getAllowedCheck()(url)) return false;
    const downloadId = await startAllowedZipDownload(chromeApi, url);
    try {
      await awaitDownloadComplete(chromeApi, downloadId);
    } catch (err) {
      try {
        console.info(JSON.stringify({
          level: 'info',
          event: 'plugin_beta_download_failed',
          downloadId: downloadId,
          error: err && err.message ? String(err.message) : 'download failed',
        }));
      } catch (_) { /* ignore */ }
      throw err;
    }
    await openExtensionsManagementPage(chromeApi);
    try {
      console.info(JSON.stringify({
        level: 'info',
        event: 'plugin_beta_download_complete_open_extensions',
        downloadId: downloadId,
      }));
    } catch (_) { /* ignore */ }
    return true;
  }

  function requestBetaUpdateDownload(chromeApi, url) {
    if (!getAllowedCheck()(url)) return false;
    const api = chromeOr(chromeApi);
    const runtime = api && api.runtime;
    if (runtime && typeof runtime.sendMessage === 'function') {
      try {
        runtime.sendMessage({ action: 'downloadBetaUpdate', url: String(url) });
        return true;
      } catch (_) { /* fall through */ }
    }
    Promise.resolve(downloadBetaUpdateAndOpenExtensions(api, url)).catch(function (err) {
      try {
        console.warn('[taskChromePlugin] beta download fallback failed:', err && err.message ? err.message : err);
      } catch (_) { /* ignore */ }
    });
    return true;
  }

  // 左键单击下载 zip；300ms 内第二次点击视为双击，取消下载请求并重新检测。
  function bindUpdateLinkRecheck(anchor, doc, chromeApi, onRecheck) {
    if (!anchor || typeof anchor.addEventListener !== 'function') return;
    let navTimer = 0;
    function cancelNav() {
      if (!navTimer) return;
      clearTimeout(navTimer);
      navTimer = 0;
    }
    anchor.addEventListener('click', function (ev) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      if (ev && ev.detail > 1) return;
      cancelNav();
      const href = anchor.href;
      navTimer = setTimeout(function () {
        navTimer = 0;
        if (requestBetaUpdateDownload(chromeApi, href)) return;
        const view = doc && doc.defaultView;
        if (view && typeof view.open === 'function') view.open(href, '_blank', 'noopener,noreferrer');
      }, 300);
    });
    anchor.addEventListener('dblclick', function (ev) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      cancelNav();
      if (typeof onRecheck === 'function') return onRecheck();
    });
  }

  const api = {
    EXTENSIONS_PAGE_URL,
    filenameFromAllowedDownloadUrl,
    openExtensionsManagementPage,
    awaitDownloadComplete,
    startAllowedZipDownload,
    downloadBetaUpdateAndOpenExtensions,
    requestBetaUpdateDownload,
    bindUpdateLinkRecheck,
  };

  function attachToPluginVersion(target) {
    if (!target || typeof target !== 'object') return target;
    Object.assign(target, api);
    return target;
  }

  if (global && global.PluginVersion) attachToPluginVersion(global.PluginVersion);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ...api, attachToPluginVersion };
  }
  if (global) global.PluginVersionDownload = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
