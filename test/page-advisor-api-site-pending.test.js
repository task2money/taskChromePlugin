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

console.log('page-advisor-api site pending endpoints ok');
