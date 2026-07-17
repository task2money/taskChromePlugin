/**
 * 创建任务 auto_run 时附带用户公网 IP（对齐 work-panel attachClientPublicIpForAutoRun）。
 * 纯函数 + 可注入 fetch，供 api.js / node --test 共用。
 */

/**
 * @param {Record<string, any>|null|undefined} payload
 * @returns {boolean}
 */
function shouldFetchClientPublicIp(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.auto_run !== true) return false;
  return !String(payload.client_public_ip || '').trim();
}

/**
 * @param {Record<string, any>} payload
 * @param {string} ip
 * @returns {Record<string, any>}
 */
function withClientPublicIp(payload, ip) {
  const next = payload && typeof payload === 'object' ? { ...payload } : {};
  const v = String(ip || '').trim();
  if (v) next.client_public_ip = v;
  return next;
}

/**
 * auto_run=true 且尚无 client_public_ip 时，调用 fetchIp 写入。
 * 查询失败不阻断创建（后端仍可从创建请求 XFF 兜底）。
 *
 * @param {Record<string, any>} payload
 * @param {() => Promise<string>} fetchIp
 * @returns {Promise<Record<string, any>>}
 */
async function attachClientPublicIpForAutoRun(payload, fetchIp) {
  const next = payload && typeof payload === 'object' ? { ...payload } : {};
  if (!shouldFetchClientPublicIp(next)) {
    return next;
  }
  if (typeof fetchIp !== 'function') {
    return next;
  }
  try {
    const ip = String((await fetchIp()) || '').trim();
    return withClientPublicIp(next, ip);
  } catch (e) {
    console.warn('[taskChromePlugin] client-ip 查询失败，将由服务端 XFF 解析:', e);
    return next;
  }
}

const ClientPublicIp = {
  shouldFetchClientPublicIp,
  withClientPublicIp,
  attachClientPublicIpForAutoRun,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientPublicIp;
}
