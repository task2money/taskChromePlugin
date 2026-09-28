'use strict';

/**
 * 自动创新调用方式文案表（lib/i18n-llm-route.js）的中英对照契约。
 *
 * 该表覆盖 paSaasWorkspaceLabel / paSaasWorkspaceRetry 等工作空间下拉文案，
 * 只对中文加键、漏英文会让英文用户在弹窗里看到中文或空串。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { zh, en } = require('../lib/i18n-llm-route.js');

describe('i18n-llm-route 中英对照', () => {
  it('中英键集合一致（不漏键）', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
    assert.deepEqual(missingInEn, [], `en 缺少这些键: ${missingInEn.join(', ')}`);
    assert.deepEqual(missingInZh, [], `zh 缺少这些键: ${missingInZh.join(', ')}`);
  });

  it('工作空间下拉重试文案中英齐备（OPT-20260928-004）', () => {
    assert.equal(zh.paSaasWorkspaceRetry, '重试');
    assert.equal(en.paSaasWorkspaceRetry, 'Retry');
    assert.equal(zh.paSaasWorkspaceLabel, '工作空间');
    assert.equal(en.paSaasWorkspaceLabel, 'Workspace');
  });

  it('弹窗重试按钮真的取这条文案，且默认隐藏', () => {
    const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    const tag = html.match(/<button[^>]*id="popupSaasWorkspaceRetry"[^>]*>/);
    assert.ok(tag, '缺少 #popupSaasWorkspaceRetry');
    assert.match(tag[0], /data-i18n="paSaasWorkspaceRetry"/);
    assert.match(tag[0], /\bhidden\b/);
    // 键必须在 popup 页实际加载的文案表里，否则 data-i18n 取不到
    const { I18N_SCRIPT_RELS } = require('./helpers/txRuntime.js');
    assert.ok(
      I18N_SCRIPT_RELS.includes('lib/i18n-llm-route.js'),
      'i18n-llm-route.js 必须在弹窗文案表加载清单中',
    );
  });
});
