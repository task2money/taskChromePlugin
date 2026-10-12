'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

// Load via require after priming APIHttp stub if needed.
const PageAdvisorAPI = require('../lib/page-advisor-api.js');

assert.ok(PageAdvisorAPI.ENDPOINTS.pendingSuggestions.includes('pending-suggestions'));
assert.ok(PageAdvisorAPI.ENDPOINTS.confirmSuggestion.includes('/confirm/'));
assert.ok(PageAdvisorAPI.ENDPOINTS.dismissSuggestion.includes('/dismiss/'));
assert.equal(typeof PageAdvisorAPI.listPendingSuggestions, 'function');
assert.equal(typeof PageAdvisorAPI.confirmSuggestion, 'function');
assert.equal(typeof PageAdvisorAPI.dismissSuggestion, 'function');

const APIHttp = require('../lib/api-http.js');

async function assertPageUrlEncodedOnce() {
  const original = APIHttp.fetchWithClientTrace;
  let seen = '';
  APIHttp.fetchWithClientTrace = async (url) => {
    seen = url;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ items: [] }),
    };
  };
  try {
    await PageAdvisorAPI.listPendingSuggestions(
      '884588082601422848',
      'https://aidevpush.com/how-to-use',
      { baseUrl: 'https://aidevpush.com', token: 'test-token' },
    );
  } finally {
    APIHttp.fetchWithClientTrace = original;
  }
  const parsed = new URL(seen);
  assert.equal(parsed.searchParams.get('page_url'), 'https://aidevpush.com/how-to-use');
  assert.equal(
    parsed.search,
    '?page_url=https%3A%2F%2Faidevpush.com%2Fhow-to-use',
  );
}

assertPageUrlEncodedOnce()
  .then(() => {
    console.log('page-advisor-api site pending endpoints ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
