'use strict';

/**
 * lib/api-http.js — 无状态 HTTP 原语：trace 头 / 请求构造 / 错误格式化。
 * 由 lib/api.js 复用（OPT-20260828-018）。浏览器端 popup.html 与
 * background/service-worker.js 的 importScripts 必须先于 lib/api.js 加载本文件；
 * Node 端通过 require 复用。
 */

/**
 * 从 HTTP 错误响应体提取可读信息（taskAuth / DRF 常见字段）
 */
function extractErrorDetail(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    if (typeof j.error === 'string' && j.error.trim()) return j.error.trim();
    if (typeof j.detail === 'string' && j.detail.trim()) return j.detail.trim();
    if (typeof j.message === 'string' && j.message.trim()) return j.message.trim();
    if (Array.isArray(j.non_field_errors) && j.non_field_errors.length) {
      return String(j.non_field_errors[0]);
    }
  } catch (_) { /* not json */ }
  return '';
}

function formatHttpError(method, path, status, text) {
  const detail = extractErrorDetail(text);
  if (detail) return detail;
  const snippet = String(text || '').trim();
  return snippet
    ? `API ${method} ${path} → ${status}: ${snippet}`
    : `API ${method} ${path} → ${status}`;
}

function buildAuthorizationHeader(rawToken) {
  const value = String(rawToken || '').trim();
  if (!value) return '';
  if (value.startsWith('at_')) {
    return `Bearer ${value}`;
  }
  // RS256 JWT：header.payload.signature（base64url 三段非空）；旧 token 不含点分结构
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return `Bearer ${value}`;
  }
  return `Token ${value}`;
}

function buildPath(template, params = {}) {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  return path;
}

function newRequestTraceId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (_) { /* ignore */ }
  return `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function resolveTraceId(res, requestTraceId, bodyText) {
  const fromHeader = res?.headers?.get?.('X-Trace-Id') || res?.headers?.get?.('x-trace-id');
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
  try {
    const j = bodyText ? JSON.parse(bodyText) : null;
    if (j && typeof j.trace_id === 'string' && j.trace_id.trim()) return j.trace_id.trim();
    if (j && typeof j.traceId === 'string' && j.traceId.trim()) return j.traceId.trim();
  } catch (_) { /* ignore */ }
  return requestTraceId || '';
}

function throwHttpError(method, path, status, text, traceId) {
  const err = new Error(formatHttpError(method, path, status, text));
  if (traceId) err.traceId = traceId;
  throw err;
}

async function fetchWithClientTrace(url, opts, requestTraceId) {
  const fetchOpts = opts && typeof opts === 'object' ? { ...opts } : {};
  // 扩展 host_permissions 下 fetch 可能附带网页 Cookie；显式 omit，避免
  // www 会话抢过插件 Authorization: Bearer（Cookie token 曾优先于 JWT）。
  if (fetchOpts.credentials == null) fetchOpts.credentials = 'omit';
  try {
    return await fetch(url, fetchOpts);
  } catch (networkErr) {
    const err = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
    if (requestTraceId && !err.traceId) err.traceId = requestTraceId;
    throw err;
  }
}

/**
 * 通用请求方法（带当前 session Authorization）。
 * session = { baseUrl, token }，由 api.js 注入以解耦模块状态。
 */
async function request(session, method, path, body = null) {
  const url = `${session.baseUrl}${path}`;
  const requestTraceId = newRequestTraceId();
  const headers = {
    'Content-Type': 'application/json',
    'X-Trace-Id': requestTraceId,
  };
  const authHeader = buildAuthorizationHeader(session.token);
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const opts = { method, headers };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const res = await fetchWithClientTrace(url, opts, requestTraceId);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throwHttpError(method, path, res.status, text, resolveTraceId(res, requestTraceId, text));
  }
  return res.json();
}

/**
 * 公开接口请求 — 绝不附带 Authorization。
 * 登录类接口若带上过期/无效 Token，部分网关/上游会先鉴权失败（见失败经验 09）。
 */
async function requestUnauthenticated(session, method, path, body = null) {
  if (!session.baseUrl) {
    throw new Error('未配置服务器地址');
  }
  const url = `${session.baseUrl}${path}`;
  const requestTraceId = newRequestTraceId();
  const headers = {
    'Content-Type': 'application/json',
    'X-Trace-Id': requestTraceId,
  };
  const opts = { method, headers };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const res = await fetchWithClientTrace(url, opts, requestTraceId);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throwHttpError(method, path, res.status, text, resolveTraceId(res, requestTraceId, text));
  }
  return res.json();
}

const APIHttp = {
  extractErrorDetail, formatHttpError, buildAuthorizationHeader, buildPath,
  newRequestTraceId, resolveTraceId, throwHttpError, fetchWithClientTrace,
  request, requestUnauthenticated,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = APIHttp;
}
if (typeof globalThis !== 'undefined') {
  globalThis.APIHttp = APIHttp;
}
