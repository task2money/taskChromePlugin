'use strict';

/**
 * all_frames 组（cs1）i18n 门禁（ADR-0089，OPT-20260919-009 第 10 批）。
 *
 * cs1 只加载 `content-boot-gate.js` / `lib/element-picker.js` / `content/pick-frame.js`，
 * **不加载任何 lib/i18n*.js**（顶层 cs0、扩展页与 SW 都加载），因此这些文件里
 * 裸写 `tx('k')` 会在子 frame 抛 ReferenceError。与 content 层沿用同一约定：
 * 只能内联 `typeof tx === 'function' ? tx('k') : '中文'` 兜底。
 *
 * 本门禁断言：
 *  1) 不出现裸 tx()（防回归成子 frame ReferenceError）；
 *  2) 存续的 CJK 行必与取词配对——除「产品决策保护的任务描述正文」
 *     （OPT-20260919-010）与「内部断言/诊断串」（不面向用户）外；
 *  3) 取词键在 zh-CN / en 双表齐备、en 不残留中文；
 *  4) 脚本可解析（模板字面量改写不得破坏语法）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  ROOT,
  loadMessageTables,
  unpairedCjkLines,
  checkTxKeys,
} = require('./helpers/i18nScan.js');

/** cs1（all_frames）注入组：这些文件必须容忍 tx() 不存在。 */
const FRAMES_FILES = ['lib/element-picker.js', 'content/pick-frame.js'];

/** 裸 tx() 取词（不含 `TypeScript` 之类误伤；含 `?tx(` / `: tx(` 以外的一切前缀）。 */
const BARE_TX = /(?:^|[^.\w$])tx\s*\(/;

/**
 * 允许残留的未迁移 CJK（非界面文案，不随 locale 切换）：
 *  - 内部断言/诊断：程序员错误，只在开发/排障出现，不渲染给用户；
 *  - 写进任务描述字段的正文与默认值：属业务数据语言，待产品决策 OPT-20260919-010。
 */
const ALLOWED_UNPAIRED = [
  // 内部断言（`throw new Error('<标识符>: …')`）
  /^throw new Error\('[A-Za-z_$][\w$]*: [^']*'\);$/,
  /^throw new Error\('iframe 内未命中元素'\);$/,
  // 任务描述正文的默认值与脱敏标记（OPT-20260919-010）
  /^const DEFAULT_ADJUST_PROMPT = '[^']+';$/,
  /^visibleText = '\[敏感输入已省略\]';$/,
];

/** 返回 `function <name>(` 起、到函数体闭合大括号为止的 1-based 行区间。 */
function functionBodyRange(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.includes(`function ${name}(`));
  if (start < 0) return null;
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth += 1; seen = true; } else if (ch === '}') { depth -= 1; }
    }
    if (seen && depth <= 0) return [start + 1, i + 1];
  }
  return null;
}

describe('all_frames 组 i18n 门禁', () => {
  it('cs1 注入组不得裸写 tx()（该上下文不加载 lib/i18n-tx.js）', () => {
    const offenders = [];
    for (const rel of FRAMES_FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const [idx, line] of src.split('\n').entries()) {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (BARE_TX.test(line) && !/typeof\s+tx\s*===\s*['"]function['"]/.test(line)) {
          offenders.push(`${rel} L${idx + 1}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `裸 tx() 会在子 frame 抛 ReferenceError，须改为内联兜底：\n${offenders.join('\n')}`,
    );
  });

  it('BARE_TX 判据本身有效（防止门禁静默失效）', () => {
    assert.ok(BARE_TX.test("throw new Error(tx('k'));"), '应识别裸 tx()');
    assert.ok(BARE_TX.test('const x = 1; tx("k")'), '应识别裸 tx()');
    assert.ok(!BARE_TX.test('a.pickTx("k")'), '不得把 pickTx() 之类当成裸 tx()');
  });

  it('已迁移的取词均走内联兜底写法', () => {
    const pickFrame = fs.readFileSync(path.join(ROOT, FRAMES_FILES[1]), 'utf8');
    assert.match(pickFrame, /typeof tx === 'function' \? tx\('pickFramePickerNotLoaded'\)/);
    assert.match(pickFrame, /typeof tx === 'function' \? tx\('pickFrameChildIframeNotFound'\)/);

    const picker = fs.readFileSync(path.join(ROOT, FRAMES_FILES[0]), 'utf8');
    const guarded = [...picker.matchAll(/typeof tx === 'function' \? tx\('([A-Za-z_]\w*)'/g)]
      .map((m) => m[1]);
    assert.ok(guarded.length >= 8, `element-picker 兜底取词仅 ${guarded.length} 处，疑似回退`);
    assert.ok(guarded.includes('pickCrossOriginIframe'));
    assert.ok(guarded.includes('pickScreenshotUrlInvalid'));
  });

  it('存续 CJK 仅限内部断言与任务描述正文（产品决策 OPT-20260919-010）', () => {
    const rel = 'lib/element-picker.js';
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const range = functionBodyRange(src, 'formatElementAdjustmentBlock');
    assert.ok(range, '未找到 formatElementAdjustmentBlock，范围判定失效');
    // 范围自检：必须覆盖 Markdown 标题行，且不应吞掉整个文件。
    const [from, to] = range;
    assert.ok(from < to && to - from < 120, `formatElementAdjustmentBlock 行区间异常: ${from}-${to}`);
    // 范围自检：必须正好覆盖任务描述 Markdown 的起始行，否则白名单会形同虚设。
    const lines = src.split('\n');
    assert.ok(
      lines.slice(from - 1, to).some((l) => l.includes("'**页面元素调整**'")),
      `行区间 ${from}-${to} 未覆盖任务描述 Markdown 起始行`,
    );
    // 且不得吞掉文件末尾（防止大括号计数失效导致整个文件被豁免）。
    assert.ok(to < lines.length - 20, `行区间 ${from}-${to} 异常地延伸到文件末尾`);

    const problems = [];
    for (const entry of unpairedCjkLines(src)) {
      const m = /^\s*L(\d+): (.*)$/.exec(entry);
      assert.ok(m, `扫描器输出格式变化: ${entry}`);
      const no = Number(m[1]);
      const line = m[2];
      if (no >= from && no <= to) continue; // 任务描述正文（010）
      if (ALLOWED_UNPAIRED.some((re) => re.test(line))) continue;
      problems.push(`${rel} ${entry}`);
    }
    assert.deepEqual(
      problems,
      [],
      `出现未分类的残留 CJK（新增界面文案须内联兜底取词）：\n${problems.join('\n')}`,
    );
  });

  it('cs1 注入组的取词键在 zh-CN / en 双表齐备', () => {
    const tables = loadMessageTables();
    const problems = [];
    for (const rel of FRAMES_FILES) {
      problems.push(...checkTxKeys(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'), tables));
    }
    assert.deepEqual(problems, [], `tx() 键覆盖问题：\n${problems.join('\n')}`);
  });

  it('cs1 注入组脚本可解析（模板字面量改写不得破坏语法）', () => {
    const broken = [];
    for (const rel of FRAMES_FILES) {
      try {
        new vm.Script(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
      } catch (e) {
        broken.push(`${rel}: ${e.message}`);
      }
    }
    assert.deepEqual(broken, [], `脚本语法错误：\n${broken.join('\n')}`);
  });
});
