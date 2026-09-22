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

function hintStarts(html) {
  const out = [];
  const re = /<p\b[^>]*\bclass="[^"]*\bfloat-ball-hint\b[^"]*"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const i18n = (tag.match(/data-i18n="([^"]+)"/) || [])[1] || '';
    out.push({ index: m.index, tag, i18n });
  }
  return out;
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
