/**
 * Lightweight i18n for Chrome extension (ADR-0089).
 * Locale codes: zh-CN | en (same as taskFE). Storage key: aidevpush.locale
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const STORAGE_KEY = 'aidevpush.locale'
  const FALLBACK = 'zh-CN'

  /** @type {Record<string, Record<string, string>>} */
  const MESSAGES = {
    'zh-CN': {},
    en: {},
  }

  let current = FALLBACK

  function normalize(raw) {
    const s = String(raw || '').trim()
    if (!s) return null
    const lower = s.toLowerCase()
    if (lower === 'zh-cn' || lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN'
    if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en'
    return null
  }

  function t(key, params) {
    const table = MESSAGES[current] || MESSAGES[FALLBACK] || {}
    let out = table[key]
    if (out == null || out === '') {
      out = (MESSAGES[FALLBACK] || {})[key] || key
    }
    if (params && typeof params === 'object') {
      out = String(out).replace(/\{(\w+)\}/g, (_, k) =>
        params[k] != null ? String(params[k]) : `{${k}}`,
      )
    }
    return out
  }

  function setLocale(localeRaw) {
    const loc = normalize(localeRaw) || FALLBACK
    current = loc
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, loc)
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: loc })
      }
    } catch (_) {
      /* ignore */
    }
    return loc
  }

  function getLocale() {
    return current
  }

  /**
   * Register message tables (zh keys → value). en table maps zh→en or id→en.
   * @param {{ 'zh-CN'?: Record<string,string>, en?: Record<string,string> }} tables
   */
  function registerMessages(tables) {
    if (tables['zh-CN']) Object.assign(MESSAGES['zh-CN'], tables['zh-CN'])
    if (tables.en) Object.assign(MESSAGES.en, tables.en)
  }

  async function hydrateFromStorage() {
    let fromChrome = null
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const got = await chrome.storage.local.get([STORAGE_KEY])
        fromChrome = normalize(got && got[STORAGE_KEY])
      }
    } catch (_) {
      /* ignore */
    }
    let fromLs = null
    try {
      if (typeof localStorage !== 'undefined') fromLs = normalize(localStorage.getItem(STORAGE_KEY))
    } catch (_) {
      /* ignore */
    }
    const nav =
      typeof navigator !== 'undefined' ? navigator.language || (navigator.languages || [])[0] : ''
    const fromNav = normalize(nav) === 'en' ? 'en' : FALLBACK
    setLocale(fromChrome || fromLs || fromNav)
  }

  /**
   * 静态文案里可用的默认插值参数。品牌名取自 lib/plugin-brand.js 的 SSOT
   * （popup/panel/content 均先于本调用加载），避免页面上残留 `{brand}` 字面量。
   */
  function defaultParams() {
    const brand = typeof globalThis !== 'undefined' ? globalThis.PLUGIN_DISPLAY_NAME : null
    return brand ? { brand } : null
  }

  /**
   * Apply data-i18n / data-i18n-html / data-i18n-placeholder / data-i18n-title /
   * data-i18n-aria-label on a root element.
   * @param {ParentNode} [root]
   * @param {Record<string, string>} [params] 额外插值参数（与默认参数合并）
   */
  function applyDom(root, params) {
    const doc = root || (typeof document !== 'undefined' ? document : null)
    if (!doc || !doc.querySelectorAll) return
    const merged = Object.assign({}, defaultParams() || {}, params || {})
    const hasParams = Object.keys(merged).length > 0
    const tr = (key) => (hasParams ? t(key, merged) : t(key))
    doc.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n')
      if (key) el.textContent = tr(key)
    })
    doc.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html')
      if (key) el.innerHTML = tr(key) // XSS-OK: first-party locale catalog, not request/LLM HTML
    })
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder')
      if (key) el.setAttribute('placeholder', tr(key))
    })
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title')
      if (key) el.setAttribute('title', tr(key))
    })
    doc.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label')
      if (key) el.setAttribute('aria-label', tr(key))
    })
  }

  /** 只读消息表（门禁/自检用）。 */
  function getMessageTables() {
    return MESSAGES
  }

  const api = {
    STORAGE_KEY,
    t,
    setLocale,
    getLocale,
    registerMessages,
    hydrateFromStorage,
    applyDom,
    getMessageTables,
    normalize,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  global.AidevpushI18n = api
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this)
}
