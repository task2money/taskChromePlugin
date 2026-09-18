'use strict';

/**
 * 静态门禁：content/*.js 用户可见文案必须可切 en（ADR-0089，OPT-20260918-024）。
 *
 * content_scripts 与 lib 不同——它没有 data-i18n 可挂，取词唯一入口是全局 `tx()`
 * （lib/i18n-tx.js，manifest 排在全部 content/*.js 之前）。本门禁约束两件事：
 *
 *  1. 键齐备：content/*.js 引用的每个 `tx("key")` 在 zh-CN / en 两表都存在，
 *     且 en 与 zh-CN 不同、en 不含 CJK——防止「键写错」或「只补了中文」。
 *  2. 配对：已迁移文件里，任何含 CJK 的代码行都必须同时出现 `tx(`，
 *     即 CJK 只能作为 `tx("key")` 的 zh 兜底字面量存在，不得裸写在调用点。
 *
 * MIGRATED 是已迁移清单（增量收紧）：未列入的文件仍是待迁移长尾，
 * 由 OPT-20260918-024 分批推进；每迁完一批，把文件加进来即可获得防回退保护。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROOT,
  loadMessageTables,
  unpairedCjkLines,
  checkTxKeys,
} = require('./helpers/i18nScan.js');

/** 已完成 content 侧 i18n 迁移、纳入防回退门禁的文件。 */
const MIGRATED = [
  'content/float-page-advisor.js',
  'content/float-page-advisor-layer.js',
  'content/float-page-advisor-region.js',
  'content/float-page-advisor-site-pending.js',
  'content/float-pick.js',
  'content/float-form.js',
  'content/float-snapshot.js',
  'content/float-boot.js',
  'content/float-aidev.js',
  'content/float-drag-auth.js',
  'content/content.js',
];

const CONTENT_JS = fs
  .readdirSync(path.join(ROOT, 'content'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `content/${f}`)
  .sort();

describe('content/*.js i18n 覆盖门禁', () => {
  it('全部 content 脚本可解析（模板字面量改写不得破坏语法）', () => {
    const vm = require('node:vm');
    const broken = [];
    // 译文表也纳入：每批 i18n 都要改它，且它不在任何 content 行数/注入门禁内。
    const PARSE_TARGETS = [...CONTENT_JS, 'lib/i18n-messages.js', 'lib/i18n-ui-messages.js'];
    for (const rel of PARSE_TARGETS) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      try {
        // 仅解析不执行：能在 CI 早于浏览器捕获模板字面量/括号配对错误。
        new vm.Script(src, { filename: rel });
      } catch (e) {
        broken.push(`${rel}: ${e.message}`);
      }
    }
    assert.deepEqual(broken, [], `content 脚本语法错误：\n${broken.join('\n')}`);
  });

  it('content 脚本引用的 tx() 键在 zh-CN / en 两表均有独立译文', () => {
    const tables = loadMessageTables();
    const problems = [];
    for (const rel of CONTENT_JS) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      problems.push(...checkTxKeys(rel, src, tables));
    }
    assert.deepEqual(problems, [], `tx() 键覆盖问题：\n${problems.join('\n')}`);
  });

  for (const rel of MIGRATED) {
    it(`${rel} 的 CJK 文案均与 tx() 取词配对`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const unpaired = unpairedCjkLines(src);
      assert.deepEqual(
        unpaired,
        [],
        `${rel} 有 ${unpaired.length} 行硬编码 CJK 未接入 tx()：\n${unpaired.join('\n')}`,
      );
    });
  }
});
