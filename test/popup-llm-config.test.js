'use strict';

/**
 * popup-llm-config：调用方式切换须同步 saas 工作空间行显隐。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('popup-llm-config saas workspace sync', () => {
  it('定义 syncSaasWorkspaceRow 并在加载配置与路由 change 时调用', () => {
    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-llm-config.js'), 'utf8');
    assert.match(src, /function syncSaasWorkspaceRow\s*\(/);
    assert.match(src, /PopupSaasWorkspace\.syncRoute/);
    assert.match(src, /function syncSystemSkuRow\s*\(/);
    assert.match(src, /PopupSystemSku\.syncRoute/);
    const applyAt = src.indexOf('function applyLoadedConfig');
    const bindAt = src.indexOf('function bindPageAdvisorLlmEvents');
    assert.ok(applyAt >= 0 && bindAt > applyAt);
    const applyBody = src.slice(applyAt, bindAt);
    assert.match(applyBody, /syncSaasWorkspaceRow\s*\(/);
    assert.match(applyBody, /syncSystemSkuRow\s*\(/);
    const changeAt = src.indexOf("routeField.addEventListener('change'");
    assert.ok(changeAt > bindAt);
    const changeBody = src.slice(changeAt, changeAt + 400);
    assert.match(changeBody, /syncSaasWorkspaceRow\s*\(/);
    assert.match(changeBody, /syncSystemSkuRow\s*\(/);
  });

  it('currentLlmPayload 带上自有智能体 provider/model', () => {
    const src = fs.readFileSync(path.join(ROOT, 'popup/popup-llm-config.js'), 'utf8');
    assert.match(src, /ownProvider:/);
    assert.match(src, /PopupSystemSku\.currentOwnProvider/);
    assert.match(src, /ownModel:/);
    assert.match(src, /PopupSystemSku\.currentOwnModel/);
  });
});
