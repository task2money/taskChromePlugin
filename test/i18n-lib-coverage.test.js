'use strict';

/**
 * 静态门禁：lib/ 层用户可见文案必须可直接切 en（ADR-0089，OPT-20260919-009）。
 *
 * lib/ 文件被多处加载（content_scripts 主组 / popup / panel / devtools / oauth 回调页 /
 * service worker）。取词方式取决于**全部**加载它的上下文：
 *
 *  - content_scripts 主组与各扩展页都在 HTML/manifest 里先加载 `lib/i18n-tx.js`，
 *    因此能直接裸写 `tx('key')`；
 *  - service worker（importScripts）与 all_frames 组**不加载任何 i18n**，
 *    被它们加载的文件只能退回 content 层兜底或改由调用方取词。
 *
 * 本门禁因此先证明「MIGRATED 的每个文件在所有加载它的上下文里 tx() 都存在」，
 * 再复用 content/扩展页门禁的判据（键双表齐备 / CJK 与取词配对 / 禁止兜底），
 * 防止把只能在部分上下文取词的文件误纳入而埋下 ReferenceError。
 *
 * MIGRATED 是已迁移清单（增量收紧）：未列入的仍是 OPT-20260919-009 长尾。
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

/** 已完成 lib/ 层 i18n 迁移、纳入防回退门禁的文件（直接 tx() 取词）。 */
const MIGRATED = [
  // content_scripts 主组（cs0）与浮窗/面板共用
  'lib/float-panel-after-create.js',
  'lib/float-workspace-select.js',
  'lib/workspace-auto-schedule.js',
  // panel 页
  'lib/panel-create-success.js',
  // oauth-callback.html（回调页 boot 前已加载 i18n-tx.js）
  'lib/oauth-callback.js',
  'lib/oauth-callback-boot.js',
];

/** 取词器全局名所在的脚本；它在某上下文中的位置之前加载即代表 tx() 可用。 */
const TX_SCRIPT = 'lib/i18n-tx.js';

/** 按 manifest / HTML 声明顺序返回各上下文的脚本加载序列。 */
function loadContexts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const contexts = {};

  (manifest.content_scripts || []).forEach((cs, i) => {
    contexts[`content_scripts#${i}${cs.all_frames ? '(all_frames)' : ''}`] = cs.js.slice();
  });

  for (const htmlRel of ['popup/popup.html', 'panel/panel.html', 'devtools/devtools.html', 'oauth-callback.html']) {
    const abs = path.join(ROOT, htmlRel);
    if (!fs.existsSync(abs)) continue;
    const dir = path.dirname(htmlRel);
    contexts[htmlRel] = [...fs.readFileSync(abs, 'utf8').matchAll(/<script src="([^"]+)"/g)]
      .map((m) => path.posix.normalize(path.posix.join(dir, m[1])));
  }

  const swRel = path.join(ROOT, 'background/service-worker.js');
  const swSrc = fs.readFileSync(swRel, 'utf8');
  contexts['background/service-worker.js'] = [...swSrc.matchAll(/importScripts\(([^)]*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/["']([^"']+)["']/g)].map((s) => path.posix.normalize(path.posix.join('background', s[1]))));

  return contexts;
}

const CONTEXTS = loadContexts();

/** 某文件被哪些上下文加载。 */
function contextsLoading(rel) {
  return Object.entries(CONTEXTS)
    .filter(([, scripts]) => scripts.includes(rel))
    .map(([name]) => name);
}

/** 该上下文中 tx 是否先于目标文件加载（含目标文件自身就是 i18n-tx.js 的情形）。 */
function txAvailableIn(contextName, rel) {
  const scripts = CONTEXTS[contextName];
  const txAt = scripts.indexOf(TX_SCRIPT);
  if (txAt < 0) return false;
  return scripts.indexOf(rel) >= txAt;
}

describe('lib/ 层 i18n 覆盖门禁', () => {
  it('MIGRATED 文件在所有加载它的上下文中 tx() 均可用', () => {
    const problems = [];
    for (const rel of MIGRATED) {
      const where = contextsLoading(rel);
      if (where.length === 0) {
        problems.push(`${rel}: 未被任何上下文加载（清单过期？）`);
        continue;
      }
      for (const name of where) {
        if (!txAvailableIn(name, rel)) {
          problems.push(`${rel}: 上下文 ${name} 不加载 ${TX_SCRIPT}，直接 tx() 会 ReferenceError`);
        }
      }
    }
    assert.deepEqual(problems, [], `取词上下文不成立：\n${problems.join('\n')}`);
  });

  it('lib 脚本可解析（模板字面量改写不得破坏语法）', () => {
    const vm = require('node:vm');
    const broken = [];
    for (const rel of MIGRATED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      try {
        new vm.Script(src, { filename: rel });
      } catch (e) {
        broken.push(`${rel}: ${e.message}`);
      }
    }
    assert.deepEqual(broken, [], `lib 脚本语法错误：\n${broken.join('\n')}`);
  });

  it('lib 脚本引用的 tx() 键在 zh-CN / en 两表均有独立译文', () => {
    const tables = loadMessageTables();
    const problems = [];
    for (const rel of MIGRATED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      problems.push(...checkTxKeys(rel, src, tables));
    }
    assert.deepEqual(problems, [], `tx() 键覆盖问题：\n${problems.join('\n')}`);
  });

  it('lib 脚本的 tx() 取词不得退化为运行时兜底', () => {
    // 兜底只属于 all_frames / SW 这类无 i18n 的上下文；本清单已证明 tx() 恒存在。
    const offenders = [];
    for (const rel of MIGRATED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (/typeof\s+tx\s*===\s*['"]function['"]/.test(src)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `lib 脚本出现 content 层兜底取词：\n${offenders.join('\n')}`);
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
