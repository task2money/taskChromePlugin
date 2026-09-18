'use strict';

/**
 * 按运行时加载顺序安装全局取词器（ADR-0089，OPT-20260919-009）。
 *
 * content_scripts 主组、popup/panel/devtools/oauth-callback 扩展页都由 HTML/manifest
 * 保证 `lib/i18n.js` → `i18n-messages.js` → `i18n-ui-messages.js` → `i18n-tx.js`
 * 先于业务脚本加载，因此业务脚本里裸写 `tx('key')` 是合法的（不需要 content 层
 * all_frames 组那种 `typeof tx === 'function' ? … : '中文'` 兜底）。
 *
 * Node 单测直接 `require` 这些脚本时没有该全局，会抛 `tx is not defined`。
 * 在 require 业务脚本**之前**调用本 helper，即可让单测与运行时同构：
 * 默认 zh-CN，既有断言（迁移前的中文文案）保持不变。
 *
 * @param {'zh-CN'|'en'} [locale]
 * @returns {{ i18n: object, tx: (key: string, params?: object) => string }}
 */
function installTxRuntime(locale = 'zh-CN') {
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..', '..');

  const i18n = require(path.join(ROOT, 'lib/i18n.js'));
  require(path.join(ROOT, 'lib/i18n-messages.js'));
  require(path.join(ROOT, 'lib/i18n-ui-messages.js'));
  const { tx } = require(path.join(ROOT, 'lib/i18n-tx.js'));

  i18n.setLocale(locale);
  globalThis.tx = tx;
  return { i18n, tx };
}

module.exports = { installTxRuntime };
