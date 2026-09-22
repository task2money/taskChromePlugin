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

  /**
   * Persist locale to auth_user_profile. Skip when no token. Fail-open on PATCH error.
   * @param {{
   *   locale: unknown,
   *   normalize?: (raw: unknown) => string|null,
   *   hasToken?: () => boolean,
   *   patchProfile: (body: object) => Promise<unknown>,
   *   warn?: (err: unknown) => void,
   * }} deps
   * @returns {Promise<boolean>} true if skipped or PATCH ok
   */
  async function persistPreferredLocaleToProfile(deps) {
    const d = deps || {};
    const loc = typeof d.normalize === 'function' ? d.normalize(d.locale) : d.locale;
    if (!loc) return false;
    if (typeof d.hasToken === 'function' && !d.hasToken()) return true;
    if (typeof d.patchProfile !== 'function') return true;
    try {
      await d.patchProfile({ preferred_locale: loc });
      return true;
    } catch (e) {
      if (typeof d.warn === 'function') d.warn(e);
      return false;
    }
  }

  const api = { hydratePreferredLocaleFromProfile, persistPreferredLocaleToProfile };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.ProfileLocale = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
