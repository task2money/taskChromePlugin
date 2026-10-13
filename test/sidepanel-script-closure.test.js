'use strict';

/**
 * 侧边栏宿主页的脚本清单闭合：页面脚本用到的模块，`sidepanel.html` 必须真的加载了它。
 *
 * 背景（ADR-0167 回归）：提示词下拉的数据源是 `lib/page-advisor-prompt-skills.js`，
 * 而 `sidepanel.html` 漏了这三个 <script>。「假 DOM + 手工注入模块」的单测看不见宿主页
 * 到底加载了什么，于是漏脚本时全绿、真机上下拉只剩「默认提示词」一项拉不下来。
 * 这里把判据锚在真实要求上（页面脚本引用的模块 → 宿主页必须加载其定义文件），
 * 而不是锚在文件名清单上：以后再加页面脚本，只要引用了没加载的模块就会红。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SIDEPANEL_DIR = path.join(ROOT, 'sidepanel');
const HTML = path.join(SIDEPANEL_DIR, 'sidepanel.html');

/** 模块定义文件所在目录（`globalThis.X = …` 的出处）。 */
const MODULE_DIRS = ['lib', 'popup'];

/** 只留代码：注释里提到某个模块名不算「引用」。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * 扫描模块目录，建 `全局名 → 定义文件` 表。
 * 只收 PascalCase 命名空间（`Storage` / `PageAdvisorAPI` …）：小写的
 * `globalThis.tx = …` / `globalThis.confirm = …` 是零散工具函数，名字会跟页面脚本里的
 * 同名局部变量撞车，纳进来只会造出一堆假红。
 */
function collectModuleOwners() {
  const owners = new Map();
  for (const dir of MODULE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      if (!entry.endsWith('.js')) continue;
      const file = path.join(abs, entry);
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/(?:globalThis|window)\.([A-Z][\w$]*)\s*=/g)) {
        if (!owners.has(m[1])) owners.set(m[1], file);
      }
    }
  }
  return owners;
}

/** `sidepanel.html` 里 <script src> 指向的绝对路径。 */
function loadedScripts() {
  const html = fs.readFileSync(HTML, 'utf8');
  const loaded = new Set();
  for (const m of html.matchAll(/<script\s+src="([^"]+)"/g)) {
    loaded.add(path.resolve(SIDEPANEL_DIR, m[1]));
  }
  return loaded;
}

/** 侧边栏自己的页面脚本（`<script>` 直接引入、非 `lib/` 公共模块）。 */
function pageScripts() {
  return fs.readdirSync(SIDEPANEL_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(SIDEPANEL_DIR, f));
}

describe('侧边栏宿主页脚本清单闭合', () => {
  const owners = collectModuleOwners();
  const loaded = loadedScripts();

  it('模块表与加载清单都非空（判据本身没失效）', () => {
    assert.ok(owners.has('PageAdvisorPromptSkills'), '模块表应含 PageAdvisorPromptSkills');
    assert.ok(loaded.size > 20, `sidepanel.html 应加载多个脚本，实际 ${loaded.size}`);
  });

  it('页面脚本引用的每个模块，宿主页都加载了它的定义文件', () => {
    const missing = [];
    for (const file of pageScripts()) {
      const raw = fs.readFileSync(file, 'utf8');
      const src = stripComments(raw);
      const definedHere = new Set(
        [...raw.matchAll(/(?:globalThis|window)\.([A-Z][\w$]*)\s*=/g)].map((m) => m[1]),
      );
      for (const [name, owner] of owners) {
        if (definedHere.has(name)) continue;
        if (!new RegExp(`\\b${name}\\b`).test(src)) continue;
        if (loaded.has(owner)) continue;
        missing.push(`${path.relative(ROOT, file)} 引用了 ${name}，但 ${path.relative(ROOT, owner)} 未被 sidepanel.html 加载`);
      }
    }
    assert.deepEqual([...new Set(missing)], []);
  });

  it('提示词下拉的三个依赖按依赖序排在宿主页里', () => {
    const html = fs.readFileSync(HTML, 'utf8');
    const presetAt = html.indexOf('../lib/page-advisor-preset-skills.js');
    const catalogAt = html.indexOf('../lib/page-advisor-prompt-skill-catalog.js');
    const skillsAt = html.indexOf('../lib/page-advisor-prompt-skills.js');
    const panelAt = html.indexOf('agent-suggestions-panel.js');
    assert.ok(presetAt >= 0, '预埋技能表应在宿主页');
    assert.ok(catalogAt >= 0, '系统目录模块应在宿主页');
    assert.ok(skillsAt >= 0, '本机文档模块应在宿主页');
    assert.ok(panelAt >= 0, '面板脚本应在宿主页');
    assert.ok(presetAt < catalogAt, '预埋表先于目录');
    assert.ok(catalogAt < skillsAt, '目录先于本机文档模块');
    assert.ok(skillsAt < panelAt, '本机文档模块先于面板脚本（面板初始化即读它）');
  });
});
