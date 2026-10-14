'use strict';

/**
 * DevTools panel 程序化恢复工作空间不得把「手选/自动」来源改写成手选。
 *
 * 背景：loadWorkspaces 恢复上次选择后会 sel.dispatchEvent(new Event('change'))，
 * 让既有 change 处理器加载项目/成员等；但该处理器同时会 Storage.saveLastWorkspace(id)
 * （默认记手选）。若把插件自动选中的平台默认工作空间promote成「手选」，
 * 弹窗侧就不再跟随平台默认工作空间的变化（1.8.267 语义）。
 * 程序化恢复：与上次相同 → 不写；与上次不同（单一工作空间自动选中 / aidev 页匹配）
 * → 按自动选中记（manual=false）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadPanelWorkspace({ stored = '', writes } = {}) {
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    Storage: {
      getLastWorkspace: async () => stored,
      saveLastWorkspace: async (id, opts) => {
        // 与 lib/storage.js 同语义：缺省 opts 视为手选。
        writes.push({ id, manual: opts?.manual !== false });
      },
    },
    setDataTraceId() {},
    window: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window.PanelApp = {
    state: {},
    $: () => null,
    t: (k) => k,
    swApi: async () => [],
    ensureApiReady: async () => true,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'panel', 'lib', 'workspace.js'), 'utf8'),
    sandbox,
    { filename: 'panel/lib/workspace.js' },
  );
  return sandbox.window.PanelApp;
}

describe('panel 工作空间选择来源（恢复 vs 用户切换）', () => {
  it('用户切换工作空间记录为手选', async () => {
    const writes = [];
    const P = loadPanelWorkspace({ stored: 'ws-a', writes });
    await P.persistWorkspaceChoice('ws-b', { restoring: false });
    assert.deepEqual(writes, [{ id: 'ws-b', manual: true }]);
  });

  it('程序化恢复同一工作空间不写 storage（保住原有手选/自动标志）', async () => {
    const writes = [];
    const P = loadPanelWorkspace({ stored: 'ws-a', writes });
    await P.persistWorkspaceChoice('ws-a', { restoring: true });
    assert.deepEqual(writes, []);
  });

  it('程序化恢复换成别的工作空间（单一空间自动选中）按自动选中记', async () => {
    const writes = [];
    const P = loadPanelWorkspace({ stored: '', writes });
    await P.persistWorkspaceChoice('ws-only', { restoring: true });
    assert.deepEqual(writes, [{ id: 'ws-only', manual: false }]);
  });

  it('程序化恢复且无上次值、也无新值时同样不写', async () => {
    const writes = [];
    const P = loadPanelWorkspace({ stored: '', writes });
    await P.persistWorkspaceChoice('', { restoring: true });
    assert.deepEqual(writes, []);
  });

  it('loadWorkspaces 恢复期打标记，单请求/批量处理器据此分流', () => {
    const ws = fs.readFileSync(path.join(ROOT, 'panel/lib/workspace.js'), 'utf8');
    assert.match(
      ws,
      /sel\.dataset\.wsRestore = '1';[\s\S]{0,200}sel\.dispatchEvent\(new Event\('change'\)\)/,
      '恢复期须在 dispatch 前打 wsRestore 标记',
    );
    assert.match(ws, /finally\s*\{\s*delete sel\.dataset\.wsRestore;/, 'dispatch 后须清标记');
    assert.match(ws, /P\.persistWorkspaceChoice\(wsId, \{ restoring \}\)/);
    const batch = fs.readFileSync(path.join(ROOT, 'panel/tabs/batch.js'), 'utf8');
    assert.match(batch, /P\.persistWorkspaceChoice\(id, \{ restoring \}\)/);
    assert.doesNotMatch(batch, /await Storage\.saveLastWorkspace\(id\);/, '批量处理器须走共用分流');
  });
});
