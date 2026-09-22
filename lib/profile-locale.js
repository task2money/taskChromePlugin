/**
 * Hydrate plugin UI locale from auth_user_profile.preferred_locale (ADR-0089).
 * GET failure must not throw to login (fail-open).
 */
(function (global) {
  'use strict';

  /**
   * @param {{
   *   getProfile: () => Promise<{ preferred_locale?: unknown }>,
   *   applyPreferredLocaleFromProfile: (profile: object) => string|null,
   *   warn?: (err: unknown) => void,
   * }} deps
   * @returns {Promise<string|null>} applied locale or null
   */
  async function hydratePreferredLocaleFromProfile(deps) {
    const d = deps || {};
    if (typeof d.getProfile !== 'function' || typeof d.applyPreferredLocaleFromProfile !== 'function') {
      return null;
    }
    try {
      const profile = await d.getProfile();
      return d.applyPreferredLocaleFromProfile(profile) || null;
    } catch (e) {
      if (typeof d.warn === 'function') d.warn(e);
      return null;
    }
  }

  const api = { hydratePreferredLocaleFromProfile };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.ProfileLocale = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
