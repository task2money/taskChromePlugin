'use strict';

/**
 * OPT-20260918-027 回归门禁：生产登录辅助器不得再出现「精确可访问名 + 无界轮询」等待。
 *
 * 缺陷：原实现用
 *     page.getByRole('button', { name: '登录', exact: true })
 * 配合 `for (let i = 0; i < 60; i++) { if (await loginBtn.isEnabled()) break; ... }`
 * 等待提交按钮。每轮未命中都要等满 runner 的 actionTimeout(15s)，最坏 60×15.5s ≈ 930s，
 * 远超用例 180s 预算；且「精确可访问名 = 登录」一旦按钮改名/加图标/切英文即永久匹配不到，
 * 外显为 oauth-pkce e2e 恒超时（曾被误读为「预登录从未完成」）。
 *
 * 本门禁为静态源码断言（辅助器需真实浏览器才能行为化验证，不适合单测）：
 * 旧实现下前 3 例红，修复后全绿。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.resolve(__dirname, '../e2e/helpers/webLoginWithLegalAccept.js');

/**
 * 只看代码行，丢掉整行注释：修复说明里本就需要引用被禁的旧写法，
 * 注释命中会造成假红（本文件注释即含该模式）。不按 `//` 截断行内内容，
 * 以免误伤 `https://` 字面量。
 */
function codeOnly(src) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const SRC = codeOnly(fs.readFileSync(SRC_PATH, 'utf8'));

describe('webLoginWithLegalAccept 等待策略（OPT-20260918-027）', () => {
  it('不得用 exact 精确可访问名匹配提交按钮', () => {
    assert.doesNotMatch(
      SRC,
      /name:\s*['"]登录['"]\s*,\s*exact:\s*true/,
      "禁止 `getByRole('button', { name: '登录', exact: true })`：按钮改名/加图标/切英文即永久匹配不到",
    );
  });

  it('不得对可能不存在的元素做无界 isEnabled 轮询', () => {
    assert.doesNotMatch(
      SRC,
      /for\s*\([^)]*\)\s*\{\s*if\s*\([^)]*isEnabled\(\)/s,
      'isEnabled() 未命中要等满 actionTimeout，循环 60 轮会把用例拖爆；应改为有界 waitFor',
    );
  });

  it('提交按钮候选块的等待必须有界，且块内无 isEnabled 轮询', () => {
    const start = SRC.indexOf('submitCandidates');
    const end = SRC.indexOf('waitForResponse', start);
    assert.ok(start !== -1 && end > start, '应存在 submitCandidates 提交按钮候选块（旧实现没有）');
    const block = SRC.slice(start, end);
    assert.match(
      block,
      /waitFor\(\{\s*state:\s*'visible',\s*timeout:\s*\d+\s*\}\)/,
      '候选等待必须带显式 timeout，避免继承 runner 的 actionTimeout(15s)',
    );
    assert.doesNotMatch(block, /isEnabled\(\)/, '候选块内不得再出现 isEnabled 轮询');
  });

  it('提交按钮候选含 button[type=submit] 与宽松文案匹配', () => {
    assert.match(SRC, /button\[type=submit\]/, '应保留 button[type=submit] 候选');
    assert.match(SRC, /name:\s*\/[^/]*登录[^/]*\/i/, '文案匹配须为宽松正则而非 exact');
  });

  it('同意框候选含生产实际 id #login-legal-consent', () => {
    assert.match(
      SRC,
      /#login-legal-consent/,
      '生产登录页同意框为 #login-legal-consent，缺它则同意未勾选、登录被挡',
    );
  });

  it('仍以 form.requestSubmit() 提交（不依赖按钮可点击）', () => {
    assert.match(SRC, /requestSubmit\(\)/, '提交路径须保持 form.requestSubmit()');
  });
});
