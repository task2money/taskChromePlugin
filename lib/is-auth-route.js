'use strict';

/**
 * True for SaaS auth/register/reset surfaces where the float ball should not
 * distract (no workspace/project context).
 * @param {string} [pathname]
 * @returns {boolean}
 */
function isAuthRoutePath(pathname) {
  const p = String(pathname || '').split('?')[0].split('#')[0];
  if (!p) return false;
  return (
    /^\/auth(\/|$)/i.test(p)
    || /^\/login\/?$/i.test(p)
    || /^\/register\/?$/i.test(p)
    || /^\/reset-password/i.test(p)
    || /^\/system-admin\/login/i.test(p)
  );
}

if (typeof globalThis !== 'undefined') {
  globalThis.IsAuthRoutePath = { isAuthRoutePath };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAuthRoutePath };
}
