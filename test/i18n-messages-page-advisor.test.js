'use strict';

/**
 * 「采集不到页面上下文」两条提示的主表文案（lib/i18n-messages.js）：
 * 中英双表都要有、英文不能是中文原样，且 SW 采集路径确实取用（不是只给测试看的死文案）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const KEYS = ['paContextUnreachable', 'paContextRestrictedPage'];

describe('i18n-messages 页面上下文采集失败文案', () => {
  it('中英双表都有新增 key，且英文不是中文原样', () => {
    const { installTxRuntime } = require('./helpers/txRuntime.js');
    // i18n 是单例：切语言前先把当前语言（默认 zh-CN）的文案取出来。
    const zhTx = installTxRuntime('zh-CN').tx;
    const zh = KEYS.map((k) => zhTx(k));
    const enTx = installTxRuntime('en').tx;
    const en = KEYS.map((k) => enTx(k));
    installTxRuntime('zh-CN');
    KEYS.forEach((key, i) => {
      assert.ok(zh[i] && zh[i] !== key, `${key} 缺中文文案`);
      assert.ok(en[i] && en[i] !== key, `${key} 缺英文文案`);
      assert.notEqual(en[i], zh[i], `${key} 英文文案未翻译`);
    });
  });

  it('两个 key 都被 SW 采集路径取用', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'background/sw-page-advisor.js'), 'utf8');
    for (const key of KEYS) {
      assert.ok(sw.includes(`tx('${key}')`), `background/sw-page-advisor.js 未取用 ${key}`);
    }
  });
});
