'use strict';

/**
 * OPT-20261014-037：Alt+Z 未打开过弹窗时也要能解析出工作空间/租户。
 *
 * 本用例走真实 lib/page-advisor-defaults.js（不经 mock），只把 Storage/API 换成桩，
 * 钉住 SW 侧接线：resolvePlatformScope 必须把 lastWorkspaceManual 传下去，并在
 * 用户从未手选过时落到平台默认工作空间；接口失败时保持既有提示（空 scope）。
 * 负向对照：把 resolvePlatformScope 退回「只读 lastWorkspaceId」，前两条转红。
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const realDefaults = require('../lib/page-advisor-defaults.js');

const WORKSPACES = [
  { id: 'ws-other', company_id: 'c-other', name: '别的租户' },
  { id: 'ws-def', company_id: 'c-def', is_default: true, name: '默认' },
];

function loadStack({ workspaces, lastWorkspaceId, manual, fetchFails }) {
  const sandbox = {
    console,
    chrome: { tabs: { query: async () => [] }, commands: {} },
    Storage: {
      getLastWorkspace: async () => lastWorkspaceId,
      getLastWorkspaceManual: async () => manual,
    },
    API: {
      getWorkspaces: async () => {
        if (fetchFails) throw new Error('network down');
        return workspaces;
      },
    },
    PageAdvisorDefaults: realDefaults,
    PageAdvisorLlmConfig: {
      loadFromStorage: async () => ({ apiKey: '', baseUrl: '', model: '', routeMode: 'saas' }),
      resolveRoute: () => 'saas',
      isDirectLlmReady: () => false,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);
  for (const rel of [
    'lib/page-advisor-api.js',
    'lib/page-advisor-fail-trace-id.js',
    'lib/page-advisor-timing.js',
    'background/sw-page-advisor-timing-run.js',
    'background/sw-page-advisor-generate.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, {
      filename: path.basename(rel),
    });
  }
  return sandbox;
}

// 跨 vm realm 的对象原型不同，断言一律逐字段比（deepEqual 会报 not reference-equal）。
function assertScope(scope, workspaceId, tenantId) {
  assert.equal(scope.workspaceId, workspaceId);
  assert.equal(scope.tenantId, tenantId);
}

describe('resolvePlatformScope 平台默认工作空间兜底 (OPT-20261014-037)', () => {
  it('登录后从未选过工作空间：Alt+Z 直接用平台默认（不再要求先打开弹窗）', async () => {
    const sandbox = loadStack({ workspaces: WORKSPACES, lastWorkspaceId: null, manual: null });
    assertScope(await sandbox.resolvePlatformScope({}), 'ws-def', 'c-def');
  });

  it('用户手选过的工作空间不被默认覆盖', async () => {
    const sandbox = loadStack({
      workspaces: WORKSPACES, lastWorkspaceId: 'ws-other', manual: true,
    });
    assertScope(await sandbox.resolvePlatformScope({}), 'ws-other', 'c-other');
  });

  it('插件自动选中过的（非手选）跟随最新平台默认', async () => {
    const sandbox = loadStack({
      workspaces: WORKSPACES, lastWorkspaceId: 'ws-other', manual: false,
    });
    assertScope(await sandbox.resolvePlatformScope({}), 'ws-def', 'c-def');
  });

  it('页面上下文已带 workspace+tenant 时不做任何解析', async () => {
    const sandbox = loadStack({ workspaces: WORKSPACES, lastWorkspaceId: null, manual: null });
    assertScope(await sandbox.resolvePlatformScope({ workspaceId: 'ws-in', companyId: 'c-in' }),
      'ws-in', 'c-in');
  });

  it('工作空间接口失败时保持空 scope（页面继续给既有「请先选择工作空间」提示）', async () => {
    const sandbox = loadStack({ workspaces: [], lastWorkspaceId: null, manual: null, fetchFails: true });
    assertScope(await sandbox.resolvePlatformScope({}), '', '');
  });
});
