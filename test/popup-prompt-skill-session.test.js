'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '../popup/popup-prompt-skill-session.js'),
  'utf8',
);

function boot() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'popup-prompt-skill-session.js' });
  return sandbox.PopupPromptSkillSession;
}

describe('popup-prompt-skill-session', () => {
  it('normalizeAdvisorSession rejects empty token or baseUrl', () => {
    const api = boot();
    assert.equal(api.normalizeAdvisorSession({ baseUrl: 'https://saas.example', token: '' }), null);
    assert.equal(api.normalizeAdvisorSession({ baseUrl: '', token: 'tok' }), null);
    const s = api.normalizeAdvisorSession({ baseUrl: 'https://saas.example/', token: ' tok ' });
    assert.equal(s.baseUrl, 'https://saas.example');
    assert.equal(s.token, 'tok');
  });

  it('resolveAdvisorSession prefers sessionProvider over empty API', async () => {
    const api = boot();
    api.sessionProvider = async () => ({ baseUrl: 'https://saas.example', token: 'tok' });
    const s = await api.resolveAdvisorSession();
    assert.equal(s.baseUrl, 'https://saas.example');
    assert.equal(s.token, 'tok');
  });

  it('refreshPluginLoggedIn 在 getAuthStatus 失败时回退 Storage 会话', async () => {
    const sandbox = { console };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    sandbox.sendMessageWithTimeout = async () => { throw new Error('sw down'); };
    sandbox.Storage = {
      isTokenExpired: async () => false,
      getApiConfig: async () => ({ baseUrl: 'https://saas.example', token: 'tok' }),
    };
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox, { filename: 'popup-prompt-skill-session.js' });
    const api = sandbox.PopupPromptSkillSession;
    const ok = await api.refreshPluginLoggedIn();
    assert.equal(ok, true);
    assert.equal(api.isLoggedIn(), true);
  });
});
