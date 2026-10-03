'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const Recover = require('../lib/builtin-edge-registration-recover.js');

describe('BuiltinEdgeRegistrationRecover', () => {
  it('优先返回指纹匹配且未撤销的节点', () => {
    const picked = Recover.pickRecoverableBuiltinEdgeNode('pf_same', [
      { id: 'n-old', offer_id: 'o1', status: 'offline', install_fingerprint: 'pf_other' },
      { id: 'n-hit', offer_id: 'o2', status: 'offline', install_fingerprint: 'pf_same', device_label: 'desk' },
      { id: 'n-rev', offer_id: 'o2', status: 'revoked', install_fingerprint: 'pf_same' },
    ]);
    assert.equal(picked.id, 'n-hit');
    assert.equal(picked.offer_id, 'o2');
  });

  it('指纹全不匹配且仅一个未撤销节点时认领（覆盖重装丢失旧随机指纹）', () => {
    const picked = Recover.pickRecoverableBuiltinEdgeNode('pf_new', [
      { id: 'n-only', offer_id: 'o1', status: 'online', install_fingerprint: 'pf_old_random' },
      { id: 'n-dead', offer_id: 'o1', status: 'revoked', install_fingerprint: 'pf_new' },
    ]);
    assert.equal(picked.id, 'n-only');
  });

  it('多个未撤销节点且指纹都不匹配时不认领，避免绑到其它设备', () => {
    const picked = Recover.pickRecoverableBuiltinEdgeNode('pf_new', [
      { id: 'n1', offer_id: 'o1', status: 'offline', install_fingerprint: 'pf_a' },
      { id: 'n2', offer_id: 'o1', status: 'offline', install_fingerprint: 'pf_b' },
    ]);
    assert.equal(picked, null);
  });

  it('toActiveTunnelRow 抽出恢复保活所需字段', () => {
    const row = Recover.toActiveTunnelRow({
      id: 'node-9',
      offer_id: 'proj-1',
      device_label: '书房',
      install_fingerprint: 'pf_x',
    });
    assert.deepEqual(row, {
      projectId: 'proj-1',
      nodeId: 'node-9',
      deviceLabel: '书房',
      installFingerprint: 'pf_x',
    });
  });

  it('侧栏与 SW 加载恢复模块', () => {
    const root = path.join(__dirname, '..');
    const sp = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.html'), 'utf8');
    assert.match(sp, /builtin-edge-registration-recover\.js/);
    const sw = fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8');
    assert.match(sw, /builtin-edge-registration-recover\.js/);
  });
});
