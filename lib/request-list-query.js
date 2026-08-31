/**
 * DevTools 请求列表过滤与排序（纯函数，无 Chrome API）。
 * Panel 与 node --test 共用。
 */

const TYPE_BUCKETS = {
  xhr: 'xhr',
  fetch: 'xhr',
  preflight: 'xhr',
  document: 'doc',
  main_frame: 'doc',
  sub_frame: 'doc',
  script: 'js',
  stylesheet: 'css',
  image: 'img',
  imageset: 'img',
};

const NUMERIC_SORT_KEYS = new Set(['timestamp', 'time', 'status']);

function resourceTypeBucket(type) {
  const key = String(type || '').trim().toLowerCase();
  if (!key) return 'other';
  return TYPE_BUCKETS[key] || 'other';
}

function isCanceledRequest(req) {
  return !!(req?.canceled || req?.statusCode === 0);
}

function statusRank(req) {
  if (isCanceledRequest(req)) return -1;
  const n = Number(req?.statusCode);
  return Number.isFinite(n) ? n : 0;
}

function matchesSearch(req, search) {
  if (!search) return true;
  const q = String(search).toLowerCase();
  const url = String(req?.url || '').toLowerCase();
  const method = String(req?.method || '').toLowerCase();
  const sc = String(req?.statusCode ?? '');
  const canceledLabel = isCanceledRequest(req) ? 'canceled' : '';
  return url.includes(q) || method.includes(q) || sc.includes(q) || canceledLabel.includes(q);
}

function matchesStatus(req, status) {
  if (!status) return true;
  if (status === 'canceled') return isCanceledRequest(req);
  const code = Number(req?.statusCode);
  if (status === '2xx') return code >= 200 && code < 300;
  if (status === '3xx') return code >= 300 && code < 400;
  if (status === '4xx') return code >= 400 && code < 500;
  if (status === '5xx') return code >= 500 && code < 600;
  return true;
}

function filterRequests(requests, query = {}) {
  const list = Array.isArray(requests) ? requests : [];
  const search = query.search || '';
  const method = query.method || '';
  const status = query.status || '';
  const type = query.type || '';

  return list.filter((r) => {
    if (!matchesSearch(r, search)) return false;
    if (method && r.method !== method) return false;
    if (!matchesStatus(r, status)) return false;
    if (type && resourceTypeBucket(r.type) !== type) return false;
    return true;
  });
}

function compareValues(a, b, dir) {
  if (a < b) return dir === 'asc' ? -1 : 1;
  if (a > b) return dir === 'asc' ? 1 : -1;
  return 0;
}

function requestTimestamp(req) {
  const n = Number(req?.timestamp ?? req?.capturedAt ?? req?.timeStamp);
  return Number.isFinite(n) ? n : 0;
}

function sortKeyValue(req, key) {
  if (key === 'time') return Number(req?.time) || 0;
  if (key === 'timestamp' || key === 'capturedAt') return requestTimestamp(req);
  if (key === 'status') return statusRank(req);
  if (key === 'method') return String(req?.method || '').toUpperCase();
  if (key === 'url') return String(req?.url || '').toLowerCase();
  return requestTimestamp(req);
}

function sortRequests(requests, sort = {}) {
  const list = Array.isArray(requests) ? requests.slice() : [];
  const key = sort.key || 'timestamp';
  const dir = sort.dir === 'asc' ? 'asc' : 'desc';
  list.sort((a, b) => {
    const cmp = compareValues(sortKeyValue(a, key), sortKeyValue(b, key), dir);
    if (cmp !== 0) return cmp;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  return list;
}

function nextSortState(current, clickedKey) {
  const key = String(clickedKey || 'timestamp');
  const prevKey = current?.key || 'timestamp';
  const prevDir = current?.dir === 'asc' ? 'asc' : 'desc';
  if (key === prevKey) {
    return { key, dir: prevDir === 'desc' ? 'asc' : 'desc' };
  }
  return { key, dir: NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc' };
}

function queryRequestList(requests, query = {}, options = {}) {
  const filtered = filterRequests(requests, query);
  const sorted = sortRequests(filtered, {
    key: query.sortKey || 'timestamp',
    dir: query.sortDir || 'desc',
  });
  const limit = options.limit;
  if (Number.isFinite(limit) && limit >= 0) return sorted.slice(0, limit);
  return sorted;
}

const RequestListQuery = {
  resourceTypeBucket,
  filterRequests,
  sortRequests,
  nextSortState,
  queryRequestList,
  isCanceledRequest,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RequestListQuery;
}
if (typeof globalThis !== 'undefined') {
  globalThis.RequestListQuery = RequestListQuery;
}
