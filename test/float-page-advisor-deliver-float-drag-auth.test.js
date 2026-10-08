'use strict';

/**
 * OPT-20261008-010：建议卡还开着时改转发目标，storage 变更须立刻刷新底栏按钮文案，
 * 不必等下一次生成或点击发送。
 * 监听并入 float-drag-auth.js 的单一 bindStorageListeners（禁止多个 onChanged 叠加）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TARGETS = ['task_description', 'cursor', 'claude', 'codex'];

function loadDeliver() {
  const buttons = {
    'taskplugin-page-advisor-fill-all': { textContent: '' },
    'taskplugin-page-advisor-fill-one': { textContent: '' },
  };
  const sandbox = {
    console,
    document: {
      getElementById(id) {
        return buttons[id] || null;
      },
    },
    tx(key, params) {
      if (key === 'paDeliverAgainAll') return `发送到 ${params.name}`;
      if (key === 'paDeliverAgainOne') return `发送一条到 ${params.name}`;
      return key;
    },
    PageAdvisorDelivery: {
      normalizeTarget(raw) {
        const v = String(raw || '').trim();
        return TARGETS.includes(v) ? v : 'task_description';
      },
      isIdeDeliveryTarget(t) {
        return String(t) !== 'task_description';
      },
      ideDisplayName(t) {
        return { cursor: 'Cursor', claude: 'Claude', codex: 'Codex' }[t] || '任务描述';
      },
    },
  };
  const src = fs.readFileSync(
    path.join(__dirname, '../content/float-page-advisor-deliver.js'),
    'utf8',
  );
  vm.runInNewContext(
    `${src}\n;this.applyPageAdvisorDeliveryTargetChange = applyPageAdvisorDeliveryTargetChange;`,
    sandbox,
  );
  return { sandbox, buttons };
}

describe('转发目标 storage 变更即刻刷新底栏按钮', () => {
  it('目标改为 cursor 后按钮变为「发送到 Cursor」', () => {
    const { sandbox, buttons } = loadDeliver();
    sandbox.applyPageAdvisorDeliveryTargetChange('cursor');
    assert.equal(buttons['taskplugin-page-advisor-fill-all'].textContent, '发送到 Cursor');
    assert.equal(buttons['taskplugin-page-advisor-fill-one'].textContent, '发送一条到 Cursor');
  });

  it('改回任务描述（非 IDE 目标）不动按钮', () => {
    const { sandbox, buttons } = loadDeliver();
    sandbox.applyPageAdvisorDeliveryTargetChange('claude');
    assert.equal(buttons['taskplugin-page-advisor-fill-all'].textContent, '发送到 Claude');
    const before = buttons['taskplugin-page-advisor-fill-all'].textContent;
    sandbox.applyPageAdvisorDeliveryTargetChange('task_description');
    assert.equal(buttons['taskplugin-page-advisor-fill-all'].textContent, before);
  });

  it('单一 storage.onChanged 监听派发 pageAdvisorDeliveryTarget（不新增监听）', () => {
    const contentDir = path.join(__dirname, '../content');
    const files = fs.readdirSync(contentDir).filter((f) => f.endsWith('.js'));
    let addListenerCount = 0;
    let dispatchFile = '';
    for (const f of files) {
      const src = fs.readFileSync(path.join(contentDir, f), 'utf8');
      addListenerCount += (src.match(/chrome\.storage\.onChanged\.addListener/g) || []).length;
      if (/changes\.pageAdvisorDeliveryTarget[\s\S]{0,120}applyPageAdvisorDeliveryTargetChange/.test(src)) {
        dispatchFile = f;
      }
    }
    assert.equal(addListenerCount, 1, 'content 层只允许一个 storage.onChanged 监听');
    assert.equal(dispatchFile, 'float-drag-auth.js');
  });
});
