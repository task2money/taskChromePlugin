'use strict';

/**
 * 区域功能说明须收在标题旁「!」details 内，默认不展开。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXEMPT_I18N = new Set(['paSkillConflictTitle']);

function popupHtml() {
  return fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
}

/**
 * 区域说明段落：class 含 float-ball-hint，或带稳定标识 data-region-help
 * （OPT-20260922-014：class 名漂移后仅靠 class 会漏检）。同一段落两种标记按位置去重。
 */
function hintStarts(html) {
  const byPos = new Map();
  for (const re of [
    /<p\b[^>]*\bclass="[^"]*\bfloat-ball-hint\b[^"]*"[^>]*>/gi,
    /<p\b[^>]*\bdata-region-help\b[^>]*>/gi,
  ]) {
    let m;
    while ((m = re.exec(html))) {
      if (!byPos.has(m.index)) byPos.set(m.index, m[0]);
    }
  }
  return [...byPos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, tag]) => ({
      index,
      tag,
      i18n: (tag.match(/data-i18n="([^"]+)"/) || [])[1] || '',
      hasRegionHelpAttr: /\bdata-region-help\b/.test(tag),
    }));
}

function insideBangDetails(html, pos) {
  const before = html.slice(0, pos);
  const lastOpen = before.lastIndexOf('<details');
  const lastClose = before.lastIndexOf('</details>');
  if (lastOpen < 0 || lastClose > lastOpen) return false;
  const openTagEnd = html.indexOf('>', lastOpen);
  const openTag = html.slice(lastOpen, openTagEnd + 1);
  if (/\bopen\b/.test(openTag)) return false;
  const chunk = html.slice(lastOpen, pos);
  return /<summary\b[^>]*>\s*!\s*<\/summary>/i.test(chunk);
}

describe('Popup 区域说明收在 ! 内（默认折叠）', () => {
  it('每个 float-ball-hint（冲突告警除外）都在未展开的 ! details 里', () => {
    const html = popupHtml();
    const hints = hintStarts(html);
    assert.ok(hints.length >= 4, `应至少有 4 处区域说明，实际 ${hints.length}`);
    const bad = hints.filter((h) => {
      if (EXEMPT_I18N.has(h.i18n)) return false;
      return !insideBangDetails(html, h.index);
    });
    assert.deepEqual(
      bad.map((h) => h.i18n || h.tag),
      [],
      '区域说明不得常显：须放进 <details><summary>!</summary>',
    );
  });

  it('每个区域说明段落都带稳定标识 data-region-help（OPT-20260922-014）', () => {
    const hints = hintStarts(popupHtml()).filter((h) => !EXEMPT_I18N.has(h.i18n));
    assert.ok(hints.length >= 4, `应至少有 4 处区域说明，实际 ${hints.length}`);
    const missing = hints.filter((h) => !h.hasRegionHelpAttr);
    assert.deepEqual(
      missing.map((h) => h.i18n || h.tag),
      [],
      '区域说明须带 data-region-help：class 名可漂移，属性才是门禁可依赖的稳定标识',
    );
  });

  it('Auto-innovate / Skill / 悬浮球标题行均有 !', () => {
    const html = popupHtml();
    for (const id of [
      'pageAdvisorLlmSection',
      'pageAdvisorSkillSection',
      'floatBallSection',
    ]) {
      const m = html.match(new RegExp(`id="${id}"[\\s\\S]*?<\\/section>`));
      assert.ok(m, `缺少 ${id}`);
      assert.match(m[0], /<summary[^>]*>!<\/summary>/, `${id} 须有 !`);
    }
  });
});
