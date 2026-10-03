/**
 * 插件实例安装指纹：按浏览器特征生成稳定唯一 ID，首次写入 chrome.storage.local。
 * Secret-Hardcode-OK: 本地 storage key 与哈希盐，非云凭据。
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pluginInstallFingerprint';

  /**
   * Collect stable-ish browser traits for hashing (no PII beyond UA/locale).
   * @param {Record<string, unknown>|null|undefined} nav
   * @param {Record<string, unknown>|null|undefined} scr
   * @param {{runtimeId?:string,timeZone?:string}|null|undefined} extra
   * @returns {string}
   */
  function collectBrowserFingerprintSeed(nav, scr, extra) {
    const n = nav || {};
    const s = scr || {};
    const parts = [
      String(n.userAgent || ''),
      String(n.language || ''),
      String((n.languages && Array.isArray(n.languages)) ? n.languages.join(',') : ''),
      String(n.platform || ''),
      String(n.hardwareConcurrency || ''),
      String(n.deviceMemory || ''),
      String(n.maxTouchPoints || ''),
      String(s.width || ''),
      String(s.height || ''),
      String(s.colorDepth || ''),
      String(s.pixelDepth || ''),
      String(extra?.timeZone || ''),
      String(extra?.runtimeId || ''),
    ];
    return parts.join('|');
  }

  /**
   * FNV-1a 64-bit hex (stable, no crypto dependency for pure tests).
   * @param {string} input
   * @returns {string}
   */
  function fnv1a64Hex(input) {
    let h = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const s = String(input || '');
    for (let i = 0; i < s.length; i += 1) {
      h ^= BigInt(s.charCodeAt(i));
      h = (h * prime) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
  }

  /**
   * Build install fingerprint id from seed + optional entropy (UUID).
   * Format: pf_<hash16>_<entropy8>
   * @param {string} seed
   * @param {string|null|undefined} entropy
   * @returns {string}
   */
  function buildInstallFingerprintId(seed, entropy) {
    const hash = fnv1a64Hex(seed);
    const ent = String(entropy || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8)
      .toLowerCase();
    const suffix = ent || fnv1a64Hex(`${seed}|fallback`).slice(0, 8);
    return `pf_${hash}_${suffix}`;
  }

  function defaultEntropy() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      }
    } catch (_) { /* ignore */ }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 8);
  }

  /**
   * Ensure a durable install fingerprint exists in storage.
   * @param {{get?:Function,set?:Function}|null|undefined} storage chrome.storage.local-like
   * @param {{navigator?:object,screen?:object,runtimeId?:string,timeZone?:string,entropy?:string}|null|undefined} env
   * @returns {Promise<string>}
   */
  async function ensurePluginInstallFingerprint(storage, env) {
    const area = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') {
      throw new Error('storage required');
    }
    const lastErr = () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          return chrome.runtime.lastError.message || 'storage error';
        }
      } catch (_) { /* ignore */ }
      return '';
    };
    const existing = await new Promise((resolve, reject) => {
      try {
        area.get([STORAGE_KEY], (bag) => {
          const err = lastErr();
          if (err) {
            reject(new Error(err));
            return;
          }
          resolve(String(bag?.[STORAGE_KEY] || '').trim());
        });
      } catch (e) {
        reject(e);
      }
    });
    if (existing) return existing;

    const nav = env?.navigator || (typeof navigator !== 'undefined' ? navigator : {});
    const scr = env?.screen || (typeof screen !== 'undefined' ? screen : {});
    let timeZone = env?.timeZone || '';
    if (!timeZone) {
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (_) {
        timeZone = '';
      }
    }
    let runtimeId = env?.runtimeId || '';
    if (!runtimeId && typeof chrome !== 'undefined') {
      try {
        runtimeId = String(chrome.runtime?.id || '');
      } catch (_) {
        runtimeId = '';
      }
    }
    const seed = collectBrowserFingerprintSeed(nav, scr, { timeZone, runtimeId });
    const id = buildInstallFingerprintId(seed, env?.entropy || defaultEntropy());
    await new Promise((resolve, reject) => {
      try {
        area.set({ [STORAGE_KEY]: id }, () => {
          const err = lastErr();
          if (err) {
            reject(new Error(err));
            return;
          }
          resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
    return id;
  }

  /**
   * Read fingerprint without creating (empty if missing).
   * @param {{get?:Function}|null|undefined} storage
   * @returns {Promise<string>}
   */
  async function getPluginInstallFingerprint(storage) {
    const area = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!area || typeof area.get !== 'function') return '';
    return new Promise((resolve) => {
      try {
        area.get([STORAGE_KEY], (bag) => {
          resolve(String(bag?.[STORAGE_KEY] || '').trim());
        });
      } catch (_) {
        resolve('');
      }
    });
  }

  const PluginInstallFingerprint = {
    STORAGE_KEY,
    collectBrowserFingerprintSeed,
    fnv1a64Hex,
    buildInstallFingerprintId,
    ensurePluginInstallFingerprint,
    getPluginInstallFingerprint,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PluginInstallFingerprint;
  }
  if (root) root.PluginInstallFingerprint = PluginInstallFingerprint;
})(typeof globalThis !== 'undefined' ? globalThis : this);
