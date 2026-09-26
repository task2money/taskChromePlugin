/**
 * Popup / DevTools 面板展示 manifest.version。
 * Beta = chrome.management.getSelf().installType === "development"
 * （Chrome 文档：未打包扩展在开发者模式加载；getSelf 不需要 management 权限）。
 * https://developer.chrome.com/docs/extensions/reference/api/management#method-getSelf
 */
(function (global) {
  'use strict';

  const LATEST_RELEASE_URL = 'https://api.github.com/repos/task2money/taskChromePlugin/releases/latest';
  const DOWNLOAD_PATH_PREFIX = '/task2money/taskChromePlugin/releases/download/';
  const CACHE_KEY = 'aidevpush.betaReleaseCheck';
  const OK_TTL_MS = 60 * 60 * 1000;
  const FAIL_TTL_MS = 15 * 60 * 1000;

  function chromeOr(chromeApi) {
    if (chromeApi !== undefined) return chromeApi;
    return typeof chrome !== 'undefined' ? chrome : undefined;
  }

  function readExtensionVersion(chromeApi) {
    const api = chromeOr(chromeApi);
    try {
      const v = api && api.runtime && typeof api.runtime.getManifest === 'function'
        ? api.runtime.getManifest().version
        : '';
      return String(v || '').trim();
    } catch (_) {
      return '';
    }
  }

  function isBetaInstallType(installType) {
    return installType === 'development';
  }

  function parseVersionParts(version) {
    const s = String(version || '').trim().replace(/^v/i, '');
    if (!/^\d+(\.\d+){0,3}$/.test(s)) return null;
    return s.split('.').map((n) => Number(n));
  }

  function compareExtensionVersions(local, remote) {
    const a = parseVersionParts(local);
    const b = parseVersionParts(remote);
    if (!a || !b) return null;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      const da = a[i] || 0;
      const db = b[i] || 0;
      if (da < db) return -1;
      if (da > db) return 1;
    }
    return 0;
  }

  function isAllowedDownloadUrl(url) {
    try {
      const u = new URL(String(url || ''));
      if (u.protocol !== 'https:') return false;
      if (u.username || u.password) return false;
      if (u.hostname !== 'github.com') return false;
      if (!u.pathname.startsWith(DOWNLOAD_PATH_PREFIX)) return false;
      if (!u.pathname.toLowerCase().endsWith('.zip')) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function parseGithubLatestRelease(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const version = String(payload.tag_name || '').trim().replace(/^v/i, '');
    if (!parseVersionParts(version)) return null;
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const preferred = 'task-chrome-plugin-v' + version + '.zip';
    const candidates = [];
    for (let i = 0; i < assets.length; i += 1) {
      const asset = assets[i];
      if (!asset || !isAllowedDownloadUrl(asset.browser_download_url)) continue;
      candidates.push(asset);
    }
    let chosen = null;
    for (let i = 0; i < candidates.length; i += 1) {
      if (candidates[i].name === preferred) {
        chosen = candidates[i];
        break;
      }
    }
    if (!chosen && candidates.length) chosen = candidates[0];
    if (!chosen) return null;
    return { version: version, downloadUrl: String(chosen.browser_download_url) };
  }

  function decideBetaReleaseNotice(input) {
    const beta = isBetaInstallType(input && input.installType);
    if (!beta) return { beta: false, update: null };
    const release = input && input.release;
    if (!release || !isAllowedDownloadUrl(release.downloadUrl)) {
      return { beta: true, update: null };
    }
    if (compareExtensionVersions(input.localVersion, release.version) !== -1) {
      return { beta: true, update: null };
    }
    return {
      beta: true,
      update: { latest: release.version, downloadUrl: release.downloadUrl },
    };
  }

  function translated(translate, key, params, fallback) {
    if (typeof translate !== 'function') return fallback;
    const out = translate(key, params);
    if (!out || out === key) return fallback;
    return out;
  }

  function formatExtensionVersionText(version, translate, options) {
    const v = String(version || '').trim();
    if (!v) return '';
    const beta = !!(options && options.beta);
    const fallback = beta ? ('v' + v + ' Beta') : ('v' + v);
    const key = beta ? 'popupVersionBetaLabel' : 'popupVersionLabel';
    return translated(translate, key, { version: v }, fallback);
  }

  function applyExtensionVersionToElement(el, chromeApi, translate, options) {
    if (!el) return false;
    const version = readExtensionVersion(chromeApi);
    if (!version) {
      el.hidden = true;
      el.textContent = '';
      return false;
    }
    const beta = !!(options && options.beta);
    el.hidden = false;
    el.textContent = formatExtensionVersionText(version, translate, { beta: beta });
    const ariaKey = beta ? 'popupVersionBetaAria' : 'popupVersionAria';
    const aria = translated(translate, ariaKey, { version: version }, el.textContent);
    if (el.setAttribute) el.setAttribute('aria-label', aria);
    return true;
  }

  async function readInstallType(chromeApi) {
    const api = chromeOr(chromeApi);
    const getSelf = api && api.management && api.management.getSelf;
    if (typeof getSelf !== 'function') return '';
    try {
      const info = await getSelf();
      return info && info.installType ? String(info.installType) : '';
    } catch (_) {
      return '';
    }
  }

  function storageAdapter(chromeApi, deps) {
    if (deps && deps.storage) return deps.storage;
    const local = chromeApi && chromeApi.storage && chromeApi.storage.local;
    if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') return null;
    return {
      async get(key) {
        const got = await local.get(key);
        return got ? got[key] : undefined;
      },
      async set(key, value) {
        await local.set({ [key]: value });
      },
    };
  }

  function nowMs(deps) {
    if (deps && typeof deps.now === 'function') return deps.now();
    return Date.now();
  }

  async function readCache(storage) {
    if (!storage || typeof storage.get !== 'function') return null;
    try {
      return await storage.get(CACHE_KEY);
    } catch (_) {
      return null;
    }
  }

  async function remember(storage, value) {
    if (!storage || typeof storage.set !== 'function') return;
    try {
      await storage.set(CACHE_KEY, value);
    } catch (_) { /* ignore */ }
  }

  async function loadLatestRelease(chromeApi, deps) {
    const storage = storageAdapter(chromeApi, deps);
    const now = nowMs(deps);
    const cached = await readCache(storage);
    if (cached && typeof cached.checkedAt === 'number') {
      const ttl = cached.ok ? OK_TTL_MS : FAIL_TTL_MS;
      if (now - cached.checkedAt < ttl) return cached.ok ? cached.release : null;
    }
    const fetchImpl = (deps && deps.fetchImpl) || (typeof fetch === 'function' ? fetch : null);
    if (typeof fetchImpl !== 'function') return cached && cached.ok ? cached.release : null;
    try {
      const res = await fetchImpl(LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'taskChromePlugin',
        },
      });
      if (!res || !res.ok) {
        await remember(storage, { checkedAt: now, ok: false, release: null });
        return cached && cached.ok ? cached.release : null;
      }
      const release = parseGithubLatestRelease(await res.json());
      if (!release) {
        await remember(storage, { checkedAt: now, ok: false, release: null });
        return null;
      }
      await remember(storage, { checkedAt: now, ok: true, release: release });
      return release;
    } catch (_) {
      return cached && cached.ok ? cached.release : null;
    }
  }

  function clearUpdateLink(versionEl) {
    const parent = versionEl && versionEl.parentElement;
    if (!parent || typeof parent.querySelector !== 'function') return;
    const link = parent.querySelector('[data-plugin-version-update]');
    if (link && typeof link.remove === 'function') link.remove();
  }

  function showUpdateLink(versionEl, model) {
    if (!versionEl || !model || !isAllowedDownloadUrl(model.downloadUrl)) return false;
    const doc = versionEl.ownerDocument;
    if (!versionEl.parentElement || !doc || typeof doc.createElement !== 'function') return false;
    const latest = String(model.latest || '').trim();
    if (!parseVersionParts(latest)) return false;
    clearUpdateLink(versionEl);
    const a = doc.createElement('a');
    a.dataset.pluginVersionUpdate = '1';
    a.className = 'plugin-version-update';
    a.href = model.downloadUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // Anti-Replay-OK: real <a href> to the published zip; no write request
    const text = translated(
      model.translate,
      'popupVersionUpdate',
      { latest: latest },
      'v' + latest,
    );
    a.textContent = text;
    const aria = translated(
      model.translate,
      'popupVersionUpdateAria',
      { latest: latest },
      text,
    );
    if (typeof a.setAttribute === 'function') a.setAttribute('aria-label', aria);
    if (typeof versionEl.insertAdjacentElement !== 'function') return false;
    versionEl.insertAdjacentElement('afterend', a);
    return true;
  }

  async function refreshExtensionVersionPresentation(el, chromeApi, translate, deps) {
    if (!applyExtensionVersionToElement(el, chromeApi, translate)) {
      return { beta: false, update: false };
    }
    const installType = await readInstallType(chromeApi);
    const beta = isBetaInstallType(installType);
    applyExtensionVersionToElement(el, chromeApi, translate, { beta: beta });
    clearUpdateLink(el);
    if (!beta) return { beta: false, update: false };
    const localVersion = readExtensionVersion(chromeApi);
    const release = await loadLatestRelease(chromeApi, deps);
    const decision = decideBetaReleaseNotice({
      installType: installType,
      localVersion: localVersion,
      release: release,
    });
    const shown = decision.update
      ? showUpdateLink(el, {
        latest: decision.update.latest,
        downloadUrl: decision.update.downloadUrl,
        translate: translate,
      })
      : false;
    if (shown) {
      el.hidden = true;
      el.textContent = '';
      if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'true');
    } else if (typeof el.removeAttribute === 'function') {
      el.removeAttribute('aria-hidden');
    }
    try {
      console.info(JSON.stringify({
        level: 'info',
        event: 'plugin_beta_release_check',
        beta: true,
        updateAvailable: !!shown,
        localVersion: localVersion,
        latestVersion: (release && release.version) || '',
      }));
    } catch (_) { /* ignore */ }
    return { beta: true, update: !!shown };
  }

  const PluginVersion = {
    LATEST_RELEASE_URL,
    readExtensionVersion,
    isBetaInstallType,
    compareExtensionVersions,
    parseGithubLatestRelease,
    decideBetaReleaseNotice,
    formatExtensionVersionText,
    applyExtensionVersionToElement,
    refreshExtensionVersionPresentation,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PluginVersion;
  }
  if (global) global.PluginVersion = PluginVersion;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
