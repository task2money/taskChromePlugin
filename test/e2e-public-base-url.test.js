'use strict';

/**
 * OAuth E2E 的站点/API 入口必须由运行者提供（E2E_PUBLIC_BASE_URL），
 * 不得在测试代码里内置任何部署域名或生产地址。
 *
 * 背景：runner 从 13718c6 起改用 E2E_PUBLIC_BASE_URL 探测 OIDC 可达性，
 * 但测试文件仍回落到旧生产域名——探测的是一个站点、实际打开的却是另一个。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEST_FILE = path.join(ROOT, 'e2e', 'oauth-pkce-login.playwright.test.js');
const RUNNER_FILE = path.join(ROOT, 'e2e', 'oauth-pkce-login.playwright.test.js.sh');

describe('oauth-pkce e2e 入口配置', () => {
  it('测试从 E2E_PUBLIC_BASE_URL 取入口，且不内置部署域名', () => {
    const src = fs.readFileSync(TEST_FILE, 'utf8');
    assert.match(src, /process\.env\.E2E_PUBLIC_BASE_URL/, '必须读取 E2E_PUBLIC_BASE_URL');
    assert.doesNotMatch(src, /aidevpush\.com/i, '不得内置旧部署域名');
    assert.doesNotMatch(src, /daydaymoney\.com/i, '不得内置当前部署域名');
    assert.doesNotMatch(src, /https:\/\/www\.[a-z0-9.-]+/i, '默认入口不得是公网站点');
  });

  it('runner 导出 E2E_PUBLIC_BASE_URL 供测试进程继承', () => {
    const src = fs.readFileSync(RUNNER_FILE, 'utf8');
    assert.match(src, /export E2E_PUBLIC_BASE_URL/, 'runner 必须 export 该变量');
  });
});
