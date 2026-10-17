'use strict';

/**
 * 运行时域名配置：唯一来源是打包期注入（conf/base.yaml → pack-crx.sh）。
 * 源码树默认值必须为空，且不得回落到任何代码域名常量。
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'lib', 'runtime-config.js');
const VALUES = path.join(ROOT, 'lib', 'runtime-config.values.js');

function loadHelper(values) {
  delete require.cache[require.resolve(HELPER)];
  globalThis.__TASKPLUGIN_RUNTIME_CONFIG__ = values || {};
  return require(HELPER);
}

describe('runtime-config', () => {
  beforeEach(() => {
    delete globalThis.__TASKPLUGIN_RUNTIME_CONFIG__;
    delete globalThis.TaskPluginRuntimeConfig;
  });

  it('源码树的 values 文件为空对象（不内置任何域名）', () => {
    const src = require('fs').readFileSync(VALUES, 'utf8');
    assert.match(src, /__TASKPLUGIN_RUNTIME_CONFIG__ \|\| \{\}/);
    assert.doesNotMatch(src, /https?:\/\//, 'values 源文件不得写入任何地址');
  });

  it('未注入配置时所有基址为空', () => {
    const rc = loadHelper(null);
    assert.equal(rc.gatewayBaseUrl, '');
    assert.equal(rc.siteBaseUrl, '');
    assert.equal(rc.docsBaseUrl, '');
    assert.deepEqual(rc.legacyHosts, []);
  });

  it('规范化尾部斜杠并拒绝非 http(s) 地址', () => {
    const rc = loadHelper({
      gatewayBaseUrl: 'https://api.example.test/',
      siteBaseUrl: 'https://www.example.test/',
      docsBaseUrl: 'ftp://docs.example.test',
    });
    assert.equal(rc.gatewayBaseUrl, 'https://api.example.test');
    assert.equal(rc.siteBaseUrl, 'https://www.example.test');
    assert.equal(rc.docsBaseUrl, '');
  });

  it('legacyHosts 匹配裸域及其子域', () => {
    const rc = loadHelper({
      gatewayBaseUrl: 'https://new.example.test',
      legacyHosts: ['https://old.example.test/path', 'OLD2.example.test'],
    });
    assert.deepEqual(rc.legacyHosts, ['old.example.test', 'old2.example.test']);
    assert.equal(rc.isLegacyHost('https://old.example.test'), true);
    assert.equal(rc.isLegacyHost('https://www.old.example.test'), true);
    assert.equal(rc.isLegacyHost('https://old2.example.test:8443'), true);
    assert.equal(rc.isLegacyHost('https://self-hosted.example.test'), false);
    assert.equal(rc.isLegacyHost(''), false);
  });
});
