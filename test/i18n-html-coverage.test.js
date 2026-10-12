'use strict';

/**
 * 静态门禁：panel/popup 页面 HTML 的用户可见文案必须可切 en（ADR-0089）。
 *
 * 判据：
 *  1. 任何含 CJK 的文本节点，其自身或祖先必须挂 data-i18n / data-i18n-html；
 *  2. 任何含 CJK 的 placeholder / title / aria-label，必须挂对应的
 *     data-i18n-placeholder / -title / -aria-label；
 *  3. 页面里出现的每个 i18n 键，zh-CN 与 en 两张表都必须有；
 *  4. 渲染结果不得残留未替换的 {param} 占位符（如 {brand}）。
 *
 * 例外只允许 JS_DRIVEN：文本由 JS 在运行期写入（t() 或动态数据），
 * 静态 data-i18n 会被覆盖，其迁移责任在 JS 侧。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { pageScriptsFromHtml } = require('./helpers/i18nScan.js');

const ROOT = path.join(__dirname, '..');

/** CJK（含全角标点）字符 */
const CJK = /[㐀-䶿一-鿿　-〿！-～]/;

/**
 * 运行期由 JS 写文本的元素（id）——静态迁移不适用，责任在对应 JS 模块。
 * 当前为空：`batchAutoRunHint` / `singleAutoRunHint` 已随 OPT-20260919-008 改为
 * 静态 data-i18n + JS 侧按消息键取词。
 */
const JS_DRIVEN = new Set();

const PAGES = ['panel/panel.html', 'popup/popup.html'];

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const ATTR_BINDINGS = ['placeholder', 'title', 'aria-label'];

/** 去掉注释与 script/style 内容，避免把代码里的 CJK 当文案。 */
function stripNonText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
}

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

/**
 * 扫描一个 HTML 文件，返回未覆盖的文案点。
 * @param {string} html
 * @returns {{line:number, kind:string, tag:string, text:string}[]}
 */
function scanUncovered(html) {
  const src = stripNonText(html);
  const stack = [];
  const out = [];
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  const pushText = (from, to) => {
    const text = src.slice(from, to);
    if (!text.trim() || !CJK.test(text)) return;
    const frame = stack[stack.length - 1];
    const covered = stack.some(
      (f) =>
        f.attrs['data-i18n'] ||
        f.attrs['data-i18n-html'] ||
        (f.attrs.id && JS_DRIVEN.has(f.attrs.id)),
    );
    if (covered) return;
    out.push({
      line: lineOf(from),
      kind: 'text',
      tag: frame ? frame.name : '(root)',
      text: text.trim().replace(/\s+/g, ' ').slice(0, 80),
    });
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(i, src.length); break; }
    if (lt > i) pushText(i, lt);
    const gt = src.indexOf('>', lt);
    if (gt < 0) break;
    const raw = src.slice(lt, gt + 1);
    const m = /^<\s*(\/?)\s*([a-zA-Z][\w-]*)/.exec(raw);
    if (!m) { i = gt + 1; continue; }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (closing) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
    } else {
      const attrs = parseAttrs(raw);
      for (const a of ATTR_BINDINGS) {
        if (!attrs[a] || !CJK.test(attrs[a])) continue;
        if (attrs[`data-i18n-${a}`]) continue;
        if (attrs.id && JS_DRIVEN.has(attrs.id)) continue;
        out.push({
          line: lineOf(lt),
          kind: `attr:${a}`,
          tag: name,
          text: attrs[a].slice(0, 80),
        });
      }
      if (!VOID_TAGS.has(name) && !/\/\s*>$/.test(raw)) stack.push({ name, attrs });
    }
    i = gt + 1;
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * 全部文案包（每个文件独立导出 `{ zh, en }`）。
 * 提示词目录、硬件库存等按域拆出的包同样登记在此，新增包须一并补入。
 */
const MESSAGE_PACKS = [
  'lib/i18n-messages.js',
  'lib/i18n-ui-messages.js',
  'lib/i18n-panel-messages.js',
  'lib/i18n-popup-messages.js',
  'lib/i18n-locale-messages.js',
  'lib/i18n-site-pending-tabs.js',
  'lib/i18n-llm-route.js',
  'lib/i18n-skill-browse-messages.js',
  'lib/i18n-hardware-stock-messages.js',
  'lib/i18n-version-messages.js',
  'lib/i18n-toolbar-pin.js',
];

/**
 * 载入插件消息表。
 * @param {boolean} withDomainPacks 是否叠加 ui / 域包（即除基础表外的全部文案包）
 */
function loadMessageTables(withDomainPacks = true) {
  const rels = withDomainPacks ? MESSAGE_PACKS : ['lib/i18n-messages.js'];
  for (const rel of MESSAGE_PACKS) delete require.cache[require.resolve('../' + rel)];
  delete require.cache[require.resolve('../lib/i18n.js')];
  const i18n = require('../lib/i18n.js');
  for (const rel of rels) require('../' + rel);
  return { i18n, tables: i18n.getMessageTables() };
}

/**
 * 键 → 定义它的文案包。页面「用了键却没加载对应包」是渲染裸 key 的根因，
 * 判据须按包的**键归属**判定，而不是按包的文件名是否出现（拆包后文件名判据会假绿）。
 * 同名键可被多个包定义，任一包被加载即可。
 * @returns {Map<string, string[]>}
 */
function keyOwners() {
  const owners = new Map();
  for (const rel of MESSAGE_PACKS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const { zh } = require(abs);
    for (const key of Object.keys(zh || {})) {
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(rel);
    }
  }
  return owners;
}

const BINDING_ATTRS = [
  'data-i18n',
  'data-i18n-html',
  'data-i18n-placeholder',
  'data-i18n-title',
  'data-i18n-aria-label',
];

/** 收集页面里引用的全部 i18n 键。 */
function collectKeys(html) {
  const keys = new Set();
  const re = new RegExp(`(${BINDING_ATTRS.join('|')})="([^"]+)"`, 'g');
  for (const m of html.matchAll(re)) keys.add(m[2]);
  return [...keys].sort();
}

describe('panel/popup HTML 双语覆盖门禁', () => {
  for (const rel of PAGES) {
    it(`${rel} 无未挂 data-i18n 的界面文案`, () => {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const uncovered = scanUncovered(html);
      const detail = uncovered
        .map((u) => `  L${u.line} <${u.tag}> ${u.kind}: ${u.text}`)
        .join('\n');
      assert.equal(
        uncovered.length,
        0,
        `${rel} 仍有 ${uncovered.length} 处硬编码 CJK 未接入 i18n：\n${detail}`,
      );
    });
  }

  it('页面引用的 i18n 键在 zh-CN / en 两表均有定义', () => {
    const { tables } = loadMessageTables();
    const missing = [];
    for (const rel of PAGES) {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const key of collectKeys(html)) {
        if (!(key in tables['zh-CN'])) missing.push(`${rel}: zh-CN 缺 ${key}`);
        if (!(key in tables.en)) missing.push(`${rel}: en 缺 ${key}`);
      }
    }
    assert.deepEqual(missing, [], `i18n 键缺失：\n${missing.join('\n')}`);
  });

  it('页面引用的域层键，页面自身须加载定义该键的文案包', () => {
    // 先快照基础表的键：getMessageTables() 返回的就是运行期那张活表，
    // 而 keyOwners() 要 require 各文案包，注册会当场把包内键写回同一张表，
    // 于是「是否为基础键」的判据会在判定过程中自己失效（整条用例假绿）。
    const baseKeys = new Set(Object.keys(loadMessageTables(false).tables['zh-CN']));
    const owners = keyOwners();
    const problems = [];
    for (const rel of PAGES) {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const scripts = pageScriptsFromHtml(rel);
      for (const key of collectKeys(html)) {
        if (baseKeys.has(key)) continue;
        const files = owners.get(key);
        if (!files || !files.length) continue; // 非文案包定义的键交给「两表均有定义」用例
        if (files.some((f) => scripts.includes(f))) continue;
        problems.push(`${rel} 引用了 ${key}，但未加载定义它的文案包（${files.join(' / ')}）`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  it('页面引用的 i18n 文案不残留未替换的 {param} 占位符', () => {
    const { i18n, tables } = loadMessageTables();
    const problems = [];
    for (const loc of ['zh-CN', 'en']) {
      i18n.setLocale(loc);
      for (const rel of PAGES) {
        const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        for (const key of collectKeys(html)) {
          const rendered = i18n.t(key, { brand: 'BRAND' });
          if (/\{[a-zA-Z]\w*\}/.test(rendered)) {
            problems.push(`${rel}: ${loc} ${key} → ${rendered.slice(0, 60)}`);
          }
          assert.equal(typeof tables[loc][key], 'string');
        }
      }
    }
    assert.deepEqual(problems, [], `存在未替换占位符：\n${problems.join('\n')}`);
  });
});
