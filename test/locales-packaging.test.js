'use strict';

/**
 * 静态门禁：`_locales/` 必须是「Chromium 可加载」的形态（OPT-20260918-027 根因防回退）。
 *
 * 判据（任一不满足，Chromium 都会**拒绝加载整个 unpacked 扩展**，表现为
 * `--load-extension` 的 e2e 在启动阶段卡死/超时，而错误信息只在 `--enable-logging`
 * 下才可见——极难定位，故用静态门禁兜住）：
 *  1. 只要存在 `_locales/`，manifest.json 必须声明 `default_locale`；
 *  2. `default_locale` 必须指向一个真实存在的 `_locales/<locale>/`；
 *  3. 每个 `_locales/<locale>/` 必须同时有 `messages_flat.json`（本仓译文 SSOT）
 *     与 `messages.json`（Chromium 读的那份，Chrome l10n schema）；
 *  4. `messages.json` 的值必须是 `{ message: <非空 string> }`（Chrome schema），
 *     键名必须符合 Chrome 的 message name 规则 `[A-Za-z0-9_@]+`；
 *  5. `messages.json` 的键集必须与 `messages_flat.json` 一致（二者同步由
 *     `scripts/build-locales.js` 维护，禁止只手改一份）；
 *  6. manifest 中出现的每个 `__MSG_<name>__` 都必须在每份 `messages.json` 里有定义。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { listLocales, toChromeMessages, checkLocale } = require('../scripts/build-locales.js');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifest.json');
const LOCALES_DIR = path.join(ROOT, '_locales');

/** Chrome l10n message name：字母数字下划线 @，且不得为空 */
const MESSAGE_NAME = /^[A-Za-z0-9_@]+$/;
/** manifest 中引用译文的占位，如 __MSG_extName__ */
const MSG_REF = /__MSG_([A-Za-z0-9_@]+)__/g;

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const locales = listLocales();

describe('_locales 打包形态（Chromium 可加载性）', () => {
  it('存在 _locales/ 时 manifest 必须声明 default_locale', () => {
    if (!fs.existsSync(LOCALES_DIR)) return; // 无本地化目录则不受该规则约束
    assert.ok(
      typeof manifest.default_locale === 'string' && manifest.default_locale.length > 0,
      '_locales/ 存在但 manifest.json 未声明 default_locale —— Chromium 会拒绝加载整个扩展'
        + '（报「已使用本地化功能，但未在清单中指定 default_locale」）',
    );
  });

  it('default_locale 指向真实存在的 locale 目录', () => {
    if (!manifest.default_locale) return;
    assert.ok(
      locales.includes(manifest.default_locale),
      `default_locale="${manifest.default_locale}" 在 _locales/ 下无对应目录（现有：${locales.join(', ')}）`,
    );
  });

  it('每个 locale 目录都有 messages_flat.json 与同步的 messages.json', () => {
    assert.ok(locales.length > 0, '_locales/ 下没有任何 locale 目录');
    for (const locale of locales) {
      const { status } = checkLocale(locale);
      assert.equal(
        status,
        'ok',
        `_locales/${locale}: ${status} —— messages.json 由 scripts/build-locales.js 生成，勿手工分叉`,
      );
    }
  });

  it('messages.json 符合 Chrome l10n schema 且键名合法', () => {
    for (const locale of locales) {
      const file = path.join(LOCALES_DIR, locale, 'messages.json');
      const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(messages)) {
        assert.match(key, MESSAGE_NAME, `_locales/${locale}/messages.json 键名非法：${key}`);
        assert.equal(typeof value, 'object', `_locales/${locale}/messages.json 的 ${key} 必须是对象`);
        assert.equal(
          typeof value.message,
          'string',
          `_locales/${locale}/messages.json 的 ${key} 缺少 string 类型的 message`,
        );
        assert.ok(
          value.message.length > 0,
          `_locales/${locale}/messages.json 的 ${key} 的 message 为空`,
        );
      }
    }
  });

  it('messages.json 与 messages_flat.json 键集一致', () => {
    for (const locale of locales) {
      const flat = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, locale, 'messages_flat.json'), 'utf8'),
      );
      const chrome = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, locale, 'messages.json'), 'utf8'),
      );
      assert.deepEqual(
        Object.keys(chrome).sort(),
        Object.keys(flat).sort(),
        `_locales/${locale}: messages.json 与 messages_flat.json 键集不一致`,
      );
      assert.deepEqual(
        chrome,
        toChromeMessages(flat),
        `_locales/${locale}: messages.json 内容与 messages_flat.json 不同步`,
      );
    }
  });

  it('manifest 引用的 __MSG_*__ 在每个 locale 都有定义', () => {
    const refs = [...fs.readFileSync(MANIFEST, 'utf8').matchAll(MSG_REF)].map((m) => m[1]);
    if (!refs.length) return;
    for (const locale of locales) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, locale, 'messages.json'), 'utf8'),
      );
      for (const ref of refs) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(messages, ref),
          `manifest 引用 __MSG_${ref}__，但 _locales/${locale}/messages.json 未定义`,
        );
      }
    }
  });
});
