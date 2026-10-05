'use strict';

/**
 * OPT-20261005-024 回归门禁：页内悬浮球已下线（设置开关同步移除），
 * 其 i18n 文案键与本地 storage 键不得回流。
 *  - i18n：showFloatBall / floatBallHint / floatBallTitle 不应再出现在
 *    locale 表与运行期词典中（防止无用文案重新引入）。
 *  - storage：启动时须一次性清理旧版残留的 floatBallEnabled/floatBallX/floatBallY。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEAD_KEYS = ['showFloatBall', 'floatBallHint', 'floatBallTitle'];
const I18N_FILES = [
  '_locales/zh_CN/messages_flat.json',
  '_locales/en/messages_flat.json',
  '_locales/zh_CN/messages.json',
  '_locales/en/messages.json',
  'lib/i18n-messages.js',
  'lib/i18n-ui-messages.js',
];

describe('悬浮球 i18n 键已清理（OPT-20261005-024）', () => {
  for (const rel of I18N_FILES) {
    it(`${rel} 不含已下线悬浮球键`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const key of DEAD_KEYS) {
        assert.ok(!src.includes(key), `${rel} 仍含已下线键 ${key}`);
      }
    });
  }
});

describe('悬浮球旧 storage 键启动即清理（OPT-20261005-024）', () => {
  it('service worker 启动调用一次性清理', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'background/service-worker.js'), 'utf8');
    assert.match(sw, /purgeLegacyFloatBallStorageOnce/, 'service worker 未调用清理方法');
  });

  it('storage 清理覆盖全部旧悬浮球键', () => {
    const storage = fs.readFileSync(path.join(ROOT, 'lib/storage.js'), 'utf8');
    assert.match(storage, /purgeLegacyFloatBallStorageOnce/);
    for (const key of ['floatBallEnabled', 'floatBallX', 'floatBallY']) {
      assert.ok(storage.includes(key), `storage 清理未覆盖 ${key}`);
    }
  });
});
