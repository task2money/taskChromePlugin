'use strict';

/**
 * 静态门禁：扩展页脚本（popup/panel）用户可见文案必须可切 en
 * （ADR-0089，OPT-20260919-009）。
 *
 * 与 content 层门禁（test/i18n-content-coverage.test.js）共用判据，
 * 但取词入口不同：popup.html / panel.html 由 HTML 保证
 * lib/i18n.js → i18n-messages.js → i18n-ui-messages.js → i18n-tx.js 先于业务脚本加载，
 * 因此扩展页脚本直接写 `tx('key')`，**不需要** content 层的
 * `typeof tx === 'function' ? …` 兜底——出现兜底即说明取词路径假设被破坏。
 *
 * MIGRATED 是已迁移清单（增量收紧）：未列入的文件仍属 OPT-20260919-009 长尾
 * （lib/、background/、devtools/、pick-frame 注入组），每迁完一批加入即可获得防回退保护。
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

/** 已完成扩展页脚本 i18n 迁移、纳入防回退门禁的文件。 */
const MIGRATED = [
  // popup 层：取词入口为全局 tx()（popup.html 先加载 lib/i18n-tx.js）
  'popup/popup.js',
  'popup/popup-auth.js',
  'popup/popup-auth-badge.js',
  'popup/popup-shortcut.js',
  'popup/popup-prompt-skill-ui.js',
  'popup/popup-prompt-skills.js',
  // panel 层：取词入口为既有封装 P.t()（panel-core.js:api.t）
  'panel/lib/workspace.js',
  'panel/lib/workspace-projects.js',
  'panel/tabs/errors.js',
  'panel/tabs/history.js',
  'panel/tabs/single-request.js',
  // panel/tabs/batch.js 仅剩 `**自动捕获**` Markdown 任务描述正文未迁：
  // 该正文写入用户任务描述字段，属产品内容，待产品决策后再纳入本清单。
];

/** 扩展页脚本的加载清单来源：HTML 中的 <script src>（lib/ 与本地脚本都算）。 */
function pageScriptsFromHtml(htmlRel) {
  const html = fs.readFileSync(path.join(ROOT, htmlRel), 'utf8');
  const dir = path.dirname(htmlRel);
  const out = [];
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
    out.push(path.posix.normalize(path.posix.join(dir, m[1])));
  }
  return out;
}

const PAGE_SCRIPTS = [...new Set([
  ...pageScriptsFromHtml('popup/popup.html'),
  ...pageScriptsFromHtml('panel/panel.html'),
])].sort();

describe('扩展页脚本 i18n 覆盖门禁', () => {
  it('MIGRATED 清单文件均真实存在于扩展页加载清单', () => {
    const missing = MIGRATED.filter((rel) => !PAGE_SCRIPTS.includes(rel));
    assert.deepEqual(missing, [], `MIGRATED 含未在 popup/panel HTML 中加载的文件：\n${missing.join('\n')}`);
  });

  it('扩展页脚本可解析（模板字面量改写不得破坏语法）', () => {
    const vm = require('node:vm');
    const broken = [];
    for (const rel of MIGRATED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      try {
        // 仅解析不执行：能在 CI 早于浏览器捕获模板字面量/括号配对错误。
        new vm.Script(src, { filename: rel });
      } catch (e) {
        broken.push(`${rel}: ${e.message}`);
      }
    }
    assert.deepEqual(broken, [], `扩展页脚本语法错误：\n${broken.join('\n')}`);
  });

  it('扩展页脚本引用的 tx() 键在 zh-CN / en 两表均有独立译文', () => {
    const tables = loadMessageTables();
    const problems = [];
    for (const rel of MIGRATED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      problems.push(...checkTxKeys(rel, src, tables));
    }
    assert.deepEqual(problems, [], `tx() 键覆盖问题：\n${problems.join('\n')}`);
  });

  it('扩展页脚本的 tx() 取词不得退化为运行时兜底', () => {
    // 兜底写法（typeof tx === 'function' ? … : '中文'）是 content_scripts all_frames 组的
    // 专利：那里不加载 i18n-tx.js。扩展页由 HTML 保证取词器存在，兜底会掩盖加载顺序回归。
    const offenders = [];
    for (const rel of MIGRATED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (/typeof\s+tx\s*===\s*['"]function['"]/.test(src)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `扩展页脚本出现 content 层兜底取词：\n${offenders.join('\n')}`);
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
