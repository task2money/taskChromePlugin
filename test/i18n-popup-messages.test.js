'use strict';

/**
 * lib/i18n-popup-messages.js 回归测试（规则 41）。
 *
 * 「快捷键」区默认收起后，绑定差异改由折叠标题旁的 ⚠️ 徽标提示；
 * 中英文文案必须同时存在，避免只补一种语言导致另一种语言空白。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { zh, en } = require('../lib/i18n-popup-messages.js');

describe('i18n-popup-messages 快捷键差异徽标文案', () => {
  it('中英文均提供徽标可见文案与非空可访问标签', () => {
    for (const [lang, table] of [['zh', zh], ['en', en]]) {
      assert.equal(typeof table.popupShortcutDiffBadge, 'string', `${lang} 缺少 popupShortcutDiffBadge`);
      assert.ok(table.popupShortcutDiffBadge.trim(), `${lang} 徽标文案为空`);
      assert.equal(
        typeof table.popupShortcutDiffBadgeAria,
        'string',
        `${lang} 缺少 popupShortcutDiffBadgeAria`,
      );
      assert.ok(table.popupShortcutDiffBadgeAria.trim(), `${lang} 徽标 aria 文案为空`);
    }
  });

  it('徽标文案语义与「绑定变化」一致', () => {
    assert.match(zh.popupShortcutDiffBadge, /绑定有变化/);
    assert.match(en.popupShortcutDiffBadge, /Binding changed/i);
  });
});

describe('i18n-popup-messages 侧栏页签名', () => {
  it('中英文页签均为「边缘算力 / Edge compute」', () => {
    assert.equal(zh.paBuiltinTab, '边缘算力');
    assert.equal(en.paBuiltinTab, 'Edge compute');
  });

  it('出售提示按新页签名指路，不再出现旧名', () => {
    assert.doesNotMatch(zh.builtinEdgeSellHint, /本机模型（边缘算力）/);
    assert.match(zh.builtinEdgeSellHint, /「边缘算力」/);
    assert.doesNotMatch(en.builtinEdgeSellHint, /On-device model \(edge compute\)/);
    assert.match(en.builtinEdgeSellHint, /Edge compute side-panel tab/);
  });
});
