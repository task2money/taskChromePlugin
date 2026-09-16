/**
 * Non-empty traceId for failed|expired page-advisor suggest jobs (constraint 24).
 * Prefer job body / poll stamp, then create-time seed, then mint — never ''.
 */

'use strict';

const PageAdvisorFailTraceId = (() => {
  /**
   * @param {object|null|undefined} job
   * @param {string} [seedTraceId]
   * @param {{ pickJobTraceId?: (job: object|null|undefined, seed: string) => string, mintTraceId?: () => string, now?: () => number, fallbackPrefix?: string }} [opts]
   * @returns {string}
   */
  function resolvePageAdvisorFailTraceId(job, seedTraceId, opts = {}) {
    const pick = opts.pickJobTraceId
      || (typeof PageAdvisorAPI !== 'undefined' && PageAdvisorAPI.pickJobTraceId
        ? PageAdvisorAPI.pickJobTraceId.bind(PageAdvisorAPI)
        : null);

    let tid = '';
    if (pick) {
      tid = String(pick(job, seedTraceId) || '').trim();
    } else {
      tid = String(
        job?.trace_id || job?.traceId || job?._resolvedTraceId || seedTraceId || '',
      ).trim();
    }

    if (tid) return tid;

    const mint = opts.mintTraceId
      || (typeof APIHttp !== 'undefined' && APIHttp.newRequestTraceId
        ? () => APIHttp.newRequestTraceId()
        : null);

    if (mint) {
      tid = String(mint() || '').trim();
    }

    const prefix = String(opts.fallbackPrefix || 'page-advisor-failed').trim() || 'page-advisor-failed';
    const nowFn = typeof opts.now === 'function' ? opts.now : Date.now;
    return tid || `${prefix}-${nowFn()}`;
  }

  return { resolvePageAdvisorFailTraceId };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorFailTraceId;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorFailTraceId = PageAdvisorFailTraceId;
}
