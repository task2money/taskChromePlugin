#!/usr/bin/env node
'use strict';

/**
 * 把 `_locales/<locale>/messages_flat.json`（扁平 `{key: string}` 译文表，i18n 导出格式）
 * 转成 Chromium 扩展要求的 `_locales/<locale>/messages.json`（`{key: {message}}`）。
 *
 * 背景（OPT-20260918-027 根因）：Chromium 只要见到 `_locales/` 目录，就要求 manifest
 * 声明 `default_locale`，且每个 `_locales/<locale>` 下必须有 Chrome l10n 格式的
 * `messages.json`；否则 **整个扩展拒绝加载**（报「已使用本地化功能，但未在清单中指定
 * default_locale」），`--load-extension` 的 e2e 因此在启动阶段超时。
 *
 * 用法：node scripts/build-locales.js [--check]
 *   --check  只校验 messages.json 与 messages_flat.json 是否同步（CI/单测用），不写盘
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');

/** @returns {string[]} 存在的 locale 目录名（如 ['en', 'zh_CN']） */
function listLocales() {
  if (!fs.existsSync(LOCALES_DIR)) return [];
  return fs
    .readdirSync(LOCALES_DIR)
    .filter((name) => fs.statSync(path.join(LOCALES_DIR, name)).isDirectory())
    .sort();
}

/**
 * 扁平表 → Chrome l10n 表。
 * @param {Record<string, string>} flat
 * @returns {Record<string, {message: string}>}
 */
function toChromeMessages(flat) {
  const out = {};
  for (const [key, message] of Object.entries(flat)) {
    out[key] = { message: String(message) };
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * @param {string} locale
 * @returns {{ flatFile: string, messagesFile: string, status: 'missing-flat'|'missing-messages'|'stale'|'ok' }}
 */
function checkLocale(locale) {
  const dir = path.join(LOCALES_DIR, locale);
  const flatFile = path.join(dir, 'messages_flat.json');
  const messagesFile = path.join(dir, 'messages.json');
  if (!fs.existsSync(flatFile)) return { flatFile, messagesFile, status: 'missing-flat' };
  if (!fs.existsSync(messagesFile)) return { flatFile, messagesFile, status: 'missing-messages' };
  const expected = JSON.stringify(toChromeMessages(readJson(flatFile)));
  const actual = JSON.stringify(readJson(messagesFile));
  return { flatFile, messagesFile, status: expected === actual ? 'ok' : 'stale' };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const locales = listLocales();
  if (!locales.length) {
    console.error(`no locale directories under ${LOCALES_DIR}`);
    process.exit(1);
  }

  let failed = 0;
  for (const locale of locales) {
    const dir = path.join(LOCALES_DIR, locale);
    const flatFile = path.join(dir, 'messages_flat.json');
    const messagesFile = path.join(dir, 'messages.json');
    if (!fs.existsSync(flatFile)) {
      console.error(`${locale}: messages_flat.json missing`);
      failed++;
      continue;
    }
    const chromeMessages = toChromeMessages(readJson(flatFile));
    const rendered = JSON.stringify(chromeMessages, null, 2) + '\n';

    if (checkOnly) {
      const { status } = checkLocale(locale);
      if (status !== 'ok') {
        console.error(`${locale}: messages.json ${status}`);
        failed++;
      } else {
        console.log(`${locale}: ok (${Object.keys(chromeMessages).length} keys)`);
      }
      continue;
    }

    const existing = fs.existsSync(messagesFile) ? fs.readFileSync(messagesFile, 'utf8') : null;
    if (existing === rendered) {
      console.log(`${locale}: unchanged (${Object.keys(chromeMessages).length} keys)`);
      continue;
    }
    fs.writeFileSync(messagesFile, rendered);
    console.log(`${locale}: wrote messages.json (${Object.keys(chromeMessages).length} keys)`);
  }

  if (failed) process.exit(1);
}

module.exports = { listLocales, toChromeMessages, checkLocale, LOCALES_DIR, ROOT };

if (require.main === module) main();
