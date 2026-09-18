'use strict';

/**
 * ADR-0089 i18n 门禁共用扫描器（content 层 / 扩展页脚本层）。
 *
 * content 层与扩展页（popup/panel）的差别不在判据而在取词入口：
 *  - content_scripts 的 all_frames 组不加载 i18n-tx.js，只能写
 *    `typeof tx === 'function' ? tx('k') : '中文'` 兜底；
 *  - popup/panel 页面由 HTML 保证 i18n-tx.js 先于业务脚本加载，直接 `tx('k')`。
 * 本模块只提供共用的「代码行 / CJK / 键齐备」判据，入口差异由各自门禁断言。
 */

const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** CJK（含全角标点）字符，与 test/i18n-html-coverage.test.js 同判据。 */
const CJK = /[㐀-䶿一-鿿　-〿！-～]/;

/**
 * 语言无关的字面量：仅用于拼接列表/路径或匹配服务端错误，不是可翻译文案。
 * `、`（U+3001）是元素标签列表的连接符，不随语言切换，故豁免。
 */
const SEPARATOR_LITERALS = ["'、'", '"、"', '`、`'];

/** 正则字面量中的服务端错误匹配片段（用于识别后端返回的既有文案，非本端拷贝）。 */
const MATCHER_LITERALS = [
  '已.*占用',
  // lib/float-workspace-select.js 的 isUnauthedWorkspacePlaceholder：
  // 整条 alternation 匹配服务端/既有 DOM 的占位文案，取词不适用于正则体。
  '请先登录|会话过期|请刷新页面|请在扩展中重新登录|加载失败',
];

/** 载入插件消息表（基础表 + panel/float 的 ui 表）。 */
function loadMessageTables() {
  for (const rel of ['lib/i18n.js', 'lib/i18n-messages.js', 'lib/i18n-ui-messages.js']) {
    delete require.cache[require.resolve(path.join(ROOT, rel))];
  }
  const i18n = require(path.join(ROOT, 'lib/i18n.js'));
  require(path.join(ROOT, 'lib/i18n-messages.js'));
  require(path.join(ROOT, 'lib/i18n-ui-messages.js'));
  return i18n.getMessageTables();
}

/**
 * 遍历源码的代码行（跳过注释与 console 日志行）。
 * console 日志是开发期诊断输出，不是用户可见文案，按 ADR-0089 不迁。
 * @param {string} src
 * @param {(line:string, no:number) => void} visit
 */
function forEachCodeLine(src, visit) {
  let inBlockComment = false;
  src.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (line.includes('console.')) return;
    // 去掉行尾注释与行内块注释，避免把 `code; // 中文说明` / `catch (_) { /* 保持默认 */ }`
    // 误判为界面文案。
    visit(
      line.replace(/\s\/\/.*$/, '').replace(/\/\*.*?\*\//g, ''),
      idx + 1,
    );
  });
}

/** 剥离语言无关的分隔符/匹配器字面量后返回该行。 */
function stripSeparators(line) {
  let out = line;
  for (const lit of SEPARATOR_LITERALS) out = out.split(lit).join('');
  for (const lit of MATCHER_LITERALS) out = out.split(lit).join('');
  return out;
}

/** 收集源码中引用的取词键（`tx('k')` / `P.t('k')` / `api.t('k')`，仅静态字面量键）。 */
function collectTxKeys(src) {
  return [...src.matchAll(/(?:\btx|\.t)\(\s*["']([A-Za-z_]\w*)["']/g)].map((m) => m[1]);
}

/** 断言某文件里引用的 tx() 键在 zh-CN / en 两表均有独立译文。 */
function checkTxKeys(rel, src, tables) {
  const problems = [];
  for (const key of collectTxKeys(src)) {
    const zh = tables['zh-CN'][key];
    const en = tables.en[key];
    if (typeof zh !== 'string') problems.push(`${rel}: zh-CN 缺 ${key}`);
    if (typeof en !== 'string') problems.push(`${rel}: en 缺 ${key}`);
    if (typeof zh === 'string' && typeof en === 'string') {
      if (en === zh) problems.push(`${rel}: ${key} 的 en 译文未落地`);
      if (CJK.test(en)) problems.push(`${rel}: ${key} 的 en 译文仍含中文 → ${en}`);
    }
  }
  return problems;
}

/**
 * 取词入口：content 层与 popup 层是全局 `tx()`；
 * panel 层沿用其既有封装 `P.t()`（直取或 `api.t()`），二者等价，门禁一视同仁。
 */
const PAIRING_RE = /(?:^|[^.\w])tx\(|\bP\.t\(|\bapi\.t\(/;

/** 返回文件中「含 CJK 但未与取词调用配对」的代码行。 */
function unpairedCjkLines(src, pairingRe = PAIRING_RE) {
  const unpaired = [];
  forEachCodeLine(src, (line, no) => {
    const code = stripSeparators(line);
    if (!CJK.test(code)) return;
    if (pairingRe.test(code)) return;
    unpaired.push(`  L${no}: ${line.trim().slice(0, 100)}`);
  });
  return unpaired;
}

module.exports = {
  ROOT,
  CJK,
  SEPARATOR_LITERALS,
  MATCHER_LITERALS,
  loadMessageTables,
  forEachCodeLine,
  stripSeparators,
  collectTxKeys,
  checkTxKeys,
  unpairedCjkLines,
};
