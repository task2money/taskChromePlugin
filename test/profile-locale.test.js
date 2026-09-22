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
