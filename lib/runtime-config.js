/**
 * 运行时域名配置读取器（扩展侧域名 SSOT）。
 *
 * 值来自 lib/runtime-config.values.js：源码树为空，发布包由 scripts/pack-crx.sh
 * 依据 Domain Contract（conf/base.yaml + cutover.env / conf-local）注入。本文件
 * 不含任何默认域名；缺失配置时所有入口返回空串，由 UI 隐藏或引导填写。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function initTaskPluginRuntimeConfig(global) {
  'use strict';

  /** @param {unknown} raw @returns {string} 去掉尾部斜杠的 http(s) 基址，非法则空 */
  function normalizeBase(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    if (!/^https?:\/\/[^/\s]+/i.test(text)) return '';
    return text.replace(/\/+$/, '');
  }

  /** @param {unknown} raw @returns {string} 小写 host，非法则空 */
  function hostOf(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    try {
      const u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
      return String(u.hostname || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function normalizeLegacyHosts(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const item of list) {
      const host = hostOf(item);
      if (host && out.indexOf(host) === -1) out.push(host);
    }
    return out;
  }

  const raw = (global && global.__TASKPLUGIN_RUNTIME_CONFIG__) || {};
  const legacyHosts = normalizeLegacyHosts(raw.legacyHosts);

  /** 用户已保存的服务器地址是否落在旧域名（含子域）上。 */
  function isLegacyHost(url) {
    const host = hostOf(url);
    if (!host) return false;
    return legacyHosts.some((base) => host === base || host.endsWith('.' + base));
  }

  const api = {
    gatewayBaseUrl: normalizeBase(raw.gatewayBaseUrl),
    siteBaseUrl: normalizeBase(raw.siteBaseUrl),
    docsBaseUrl: normalizeBase(raw.docsBaseUrl),
    legacyHosts,
    isLegacyHost,
    hostOf,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.TaskPluginRuntimeConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
}
