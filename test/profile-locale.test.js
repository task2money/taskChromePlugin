'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { hydratePreferredLocaleFromProfile } = require('../lib/profile-locale.js');

describe('hydratePreferredLocaleFromProfile', () => {
  it('applies preferred_locale from profile GET', async () => {
    const applied = [];
    const loc = await hydratePreferredLocaleFromProfile({
      getProfile: async () => ({ preferred_locale: 'en' }),
      applyPreferredLocaleFromProfile: (p) => {
        applied.push(p.preferred_locale);
        return 'en';
      },
    });
    assert.equal(loc, 'en');
    assert.deepEqual(applied, ['en']);
  });

  it('returns null when preferred_locale is empty', async () => {
    const loc = await hydratePreferredLocaleFromProfile({
      getProfile: async () => ({ preferred_locale: '' }),
      applyPreferredLocaleFromProfile: () => null,
    });
    assert.equal(loc, null);
  });

  it('GET failure returns null and does not throw', async () => {
    let warned = false;
    const loc = await hydratePreferredLocaleFromProfile({
      getProfile: async () => {
        throw new Error('network');
      },
      applyPreferredLocaleFromProfile: () => 'en',
      warn: () => {
        warned = true;
      },
    });
    assert.equal(loc, null);
    assert.equal(warned, true);
  });
});

describe('persistPreferredLocaleToProfile', () => {
  const { persistPreferredLocaleToProfile } = require('../lib/profile-locale.js');

  it('skips PATCH when hasToken is false', async () => {
    let patched = 0;
    const ok = await persistPreferredLocaleToProfile({
      locale: 'en',
      normalize: (raw) => raw,
      hasToken: () => false,
      patchProfile: async () => {
        patched += 1;
      },
    });
    assert.equal(ok, true);
    assert.equal(patched, 0);
  });

  it('PATCHes preferred_locale when token present', async () => {
    const bodies = [];
    const ok = await persistPreferredLocaleToProfile({
      locale: 'en',
      normalize: (raw) => raw,
      hasToken: () => true,
      patchProfile: async (body) => {
        bodies.push(body);
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(bodies, [{ preferred_locale: 'en' }]);
  });

  it('PATCH failure returns false and does not throw', async () => {
    let warned = false;
    const ok = await persistPreferredLocaleToProfile({
      locale: 'zh-CN',
      normalize: (raw) => raw,
      hasToken: () => true,
      patchProfile: async () => {
        throw new Error('500');
      },
      warn: () => {
        warned = true;
      },
    });
    assert.equal(ok, false);
    assert.equal(warned, true);
  });
});
