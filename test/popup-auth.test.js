'use strict';

/**
 * Popup loadState 必须在已登录未过期时 API.init，否则 PageAdvisorAPI
 * 用空 token 打到 chrome-extension:// 源，系统目录 GET 被吞掉。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { installTxInSandbox } = require('./helpers/txRuntime.js');
const AUTH_SRC = fs.readFileSync(path.join(__dirname, '../popup/popup-auth.js'), 'utf8');

function makeEl(id) {
  return {
    id,
    style: {},
    className: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    setAttribute() {},
    getAttribute() { return null; },
  };
}

function bootAuth(authReply) {
  const byId = {
    baseUrl: makeEl('baseUrl'),
    popupStatus: makeEl('popupStatus'),
    headerUserArea: makeEl('headerUserArea'),
    headerUser: makeEl('headerUser'),
    loginSection: makeEl('loginSection'),
    btnToggleLogin: makeEl('btnToggleLogin'),
    'popup-user-guide': makeEl('popup-user-guide'),
  };
  const inits = [];
  const clears = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    withTimeout: (p) => p,
    applyExpiryHintToPopup() {},
    startAuthBadgeTimer() {},
    stopAuthBadgeTimer() {},
    UserGuide: { mount() {}, renderCollapsibleHtml() { return ''; }, loadShortcutModeFromStorage: async () => {} },
    Storage: {
      getEndpointMapping: async () => ({ foo: 1 }),
      getFloatBallConfig: async () => ({ enabled: false }),
      formatTokenExpiryHint: () => '',
    },
    API: {
      init(baseUrl, token, mapping, userId) {
        inits.push({ baseUrl, token, mapping, userId });
      },
      clearSession() { clears.push(true); },
    },
    chrome: {
      runtime: {
        sendMessage: async (msg) => {
          if (msg?.action === 'getAuthStatus') return authReply;
          if (msg?.action === 'getTrackingConfig') return { success: true, data: { enabled: false } };
          if (msg?.action === 'hydratePreferredLocale') return { locale: null };
          return { success: true };
        },
      },
    },
  };
  sandbox.document = {
    documentElement: { lang: 'zh-CN' },
    querySelector: (sel) => (sel.startsWith('#') ? byId[sel.slice(1)] || null : null),
    getElementById: (id) => byId[id] || null,
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  installTxInSandbox(sandbox);
  vm.runInContext(AUTH_SRC, sandbox, { filename: 'popup-auth.js' });
  return { sandbox, inits, clears, byId };
}

describe('popup-auth loadState PageAdvisor session', () => {
  it('calls API.init with token and baseUrl when session is valid', async () => {
    const { sandbox, inits } = bootAuth({
      success: true,
      data: {
        loggedIn: true,
        expired: false,
        baseUrl: 'https://saas.example',
        token: 'tok',
        username: 'u',
        userId: '42',
      },
    });
    assert.equal(typeof sandbox.loadState, 'function');
    await sandbox.loadState();
    assert.equal(inits.length, 1);
    assert.equal(inits[0].baseUrl, 'https://saas.example');
    assert.equal(inits[0].token, 'tok');
    assert.equal(inits[0].userId, '42');
    assert.deepEqual(inits[0].mapping, { foo: 1 });
  });

  it('calls API.clearSession when token is expired', async () => {
    const { sandbox, inits, clears } = bootAuth({
      success: true,
      data: {
        expired: true,
        baseUrl: 'https://saas.example',
        token: 'old',
        username: 'u',
      },
    });
    await sandbox.loadState();
    assert.equal(inits.length, 0);
    assert.equal(clears.length, 1);
  });
});
