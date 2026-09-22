'use strict';

/**
 * OPT-20260918-027 回归门禁：e2e 必须经 launchExtensionContext 启动带扩展的浏览器。
 *
 * 背景：两个 e2e 原先直接调用 `chromium.launchPersistentContext('', { channel: 'chromium', … })`。
 * 该写法在本机 headed 下无法加载扩展 → oauth-pkce e2e 恒 180s 超时（外显为
 * 「预登录卡住」的误判）。helper 优先用缓存中完整 chromium 的 executablePath，
 * 实测同一流程 8s 内跑通。
 *
 * 同时禁止 oauth e2e 的 runner 重新引入以 real-extension-messaging 冒烟
 * 顶替真实 OAuth 链路的 FALLBACK 通道（会把登录回归伪装成通过）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 去掉「整行注释」后再扫描：说明性注释里可以正常提到被禁写法（本文件自身注释即如此），
 * 只有真实代码行才算违规。不按 `//` 截断行内内容，避免误伤 `https://` 字面量。
 */
function codeOnly(src) {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('//') && !t.startsWith('#') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

const EXT_E2E_FILES = [
  'e2e/oauth-pkce-login.playwright.test.js',
  'e2e/real-extension-messaging.playwright.test.js',
  'e2e/popup-prompt-skill-login-gate.playwright.test.js',
];

describe('e2e 扩展启动路径（OPT-20260918-027）', () => {
  for (const rel of EXT_E2E_FILES) {
    it(`${rel} 走 launchExtensionContext 且不直连 launchPersistentContext`, () => {
      const src = codeOnly(read(rel));
      assert.match(
        src,
        /require\(['"]\.\/helpers\/launchExtensionContext['"]\)/,
        '必须 require ./helpers/launchExtensionContext',
      );
      assert.match(
        src,
        /await launchExtensionContext\(\s*chromium\s*,\s*EXT_PATH/,
        '必须以 (chromium, EXT_PATH) 调用 launchExtensionContext',
      );
      assert.doesNotMatch(
        src,
        /launchPersistentContext\s*\(/,
        '不得再直接调用 launchPersistentContext（channel 写法会在 headed 下加载不了扩展）',
      );
      assert.doesNotMatch(src, /channel:\s*['"]chromium['"]/, "不得再使用易抖的 channel: 'chromium'");
    });
  }

  it('oauth runner 不再保留 FALLBACK 顶替通道', () => {
    const sh = codeOnly(read('e2e/oauth-pkce-login.playwright.test.js.sh'));
    assert.doesNotMatch(
      sh,
      /ALLOW_OAUTH_PKCE_FALLBACK/,
      'FALLBACK 通道不得回潮：OAuth 回归必须暴露，不能被 real-extension-messaging 冒烟掩盖',
    );
    assert.doesNotMatch(
      sh,
      /FALLBACK OK/,
      '不得存在把失败改写为成功的 FALLBACK 分支',
    );
  });
});
