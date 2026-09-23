'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./helpers/txRuntime.js').installTxRuntime();
require('../lib/i18n-hardware-stock-messages.js');

const Stock = require('../lib/create-task-hardware-stock.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const project = {
  id: 'p1',
  name: 'Alpha',
  company: 'ten-1',
  server_run_template: {
    selected_instance: 'ecs.g6.large',
    authorization_id: 'auth-1',
    platform: 'aliyun',
    region: 'cn-qingdao',
    zone_id: 'cn-qingdao-b',
    hardware_config: { instance_charge_type: 'PostPaid' },
  },
};

function form(extra) {
  return {
    title: 't',
    workspaceId: 'ws',
    owner: 'owner-1',
    projectIds: ['p1'],
    projectsList: [project],
    auto_run: true,
    container_image_id: 'img-1',
    ...extra,
  };
}

describe('hardware stock query', () => {
  it('builds an available-instances URL for the project run template', () => {
    const target = Stock.stockQueryTargetFromTemplate(project.server_run_template, project);
    const pathName = Stock.buildRunHardwareStockPath(
      target,
      'ten-1',
      'img-1',
      Stock.stockBillingParams(project.server_run_template),
    );
    assert.match(pathName, /\/api\/cloud\/cloud-platform\/auth-1\/available-instances\/tenant_id\/ten-1\//);
    assert.match(pathName, /InstanceType=ecs\.g6\.large/);
    assert.match(pathName, /spot_strategy=NoSpot/);
    assert.match(pathName, /zone_id=cn-qingdao-b/);
    assert.match(pathName, /container_image_id=img-1/);
  });

  it('treats a listed instance type as in stock and a missing one as out of stock', () => {
    assert.equal(
      Stock.interpretAvailableInstancesStock({ instance_types: ['ecs.g6.large'] }, 'ecs.g6.large'),
      'in_stock',
    );
    assert.equal(
      Stock.interpretAvailableInstancesStock({ instance_types: [] }, 'ecs.g6.large'),
      'out_of_stock',
    );
    assert.equal(
      Stock.interpretAvailableInstancesStock({ status: 'error' }, 'ecs.g6.large'),
      'error',
    );
  });

  it('does not attach a stock context when auto-run is off', () => {
    const payload = Stock.payloadWithStock(form({ auto_run: false }));
    assert.equal(payload.hardwareStock, undefined);
    assert.equal(payload.auto_run, false);
  });

  it('attaches the selected project template when auto-run is on', () => {
    const payload = Stock.payloadWithStock(form());
    assert.equal(payload.auto_run, true);
    assert.equal(payload.hardwareStock.companyId, 'ten-1');
    assert.equal(payload.hardwareStock.targets[0].instanceType, 'ecs.g6.large');
    assert.equal(payload.hardwareStock.containerImageId, 'img-1');
  });

  it('skips the probe when the template cannot identify a spec', () => {
    const thin = {
      ...project,
      server_run_template: { allow_auto_run: true, platform: 'aliyun' },
    };
    const payload = Stock.payloadWithStock(form({ projectsList: [thin] }));
    assert.equal(payload.hardwareStock, undefined);
  });
});

describe('hardware stock gate', () => {
  it('blocks out-of-stock hardware and points at the project details page', async () => {
    const payload = Stock.payloadWithStock(form());
    const calls = [];
    await assert.rejects(
      () => Stock.taskDataWithoutHardwareStock(payload, async (method, pathName) => {
        calls.push({ method, pathName });
        return { instance_types: [] };
      }),
      (err) => {
        assert.match(err.message, /暂无库存/);
        assert.match(err.message, /项目详情页/);
        assert.match(err.message, /Alpha/);
        assert.match(err.message, /ecs\.g6\.large/);
        assert.equal(err.traceId, undefined);
        assert.equal(err.code, 'HARDWARE_OUT_OF_STOCK');
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(payload.hardwareStock.companyId, 'ten-1');
  });

  it('keeps traceId when the stock query fails and does not create a stock message', async () => {
    const payload = Stock.payloadWithStock(form());
    const failure = new Error('API GET → 502');
    failure.traceId = 'trace-stock-1';
    await assert.rejects(
      () => Stock.taskDataWithoutHardwareStock(payload, async () => { throw failure; }),
      (err) => {
        assert.match(err.message, /查询硬件库存失败/);
        assert.doesNotMatch(err.message, /项目详情页/);
        assert.equal(err.traceId, 'trace-stock-1');
        return true;
      },
    );
  });

  it('strips the stock context and allows create when the spec is in stock', async () => {
    const payload = Stock.payloadWithStock(form());
    const body = await Stock.taskDataWithoutHardwareStock(payload, async () => ({
      instance_types: [{ instance_type: 'ecs.g6.large' }],
    }));
    assert.equal(body.hardwareStock, undefined);
    assert.equal(body.auto_run, true);
    assert.equal(payload.hardwareStock.targets.length, 1);
  });

  it('does not query when auto-run is off', async () => {
    let called = false;
    const body = await Stock.taskDataWithoutHardwareStock(
      { auto_run: false, title: 't' },
      async () => { called = true; return {}; },
    );
    assert.equal(called, false);
    assert.equal(body.auto_run, false);
  });

  it('queries once for a batch that shares the same hardware', async () => {
    const one = Stock.payloadWithStock(form({ title: 'a' }));
    const two = Stock.payloadWithStock(form({ title: 'b' }));
    let calls = 0;
    const bodies = await Stock.tasksDataWithoutHardwareStock([one, two], async () => {
      calls += 1;
      return { instance_types: ['ecs.g6.large'] };
    });
    assert.equal(calls, 1);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].hardwareStock, undefined);
    assert.equal(bodies[1].title, 'b');
  });
});

describe('create-task call sites', () => {
  it('float, panel, and the service worker use the stock gate', () => {
    assert.match(read('content/float-form.js'), /CreateTaskHardwareStock\.payloadWithStock/);
    assert.match(read('panel/tabs/single-request.js'), /CreateTaskHardwareStock\.payloadWithStock/);
    assert.match(read('panel/tabs/batch.js'), /CreateTaskHardwareStock\.payloadWithStock/);
    assert.match(read('panel/tabs/batch.js'), /projectsList/);
    assert.match(read('background/sw-messages-task.js'), /taskDataWithoutHardwareStock/);
    assert.match(read('background/sw-messages-task.js'), /tasksDataWithoutHardwareStock/);
    const manifest = JSON.parse(read('manifest.json'));
    const scripts = manifest.content_scripts[0].js;
    const stockAt = scripts.indexOf('lib/create-task-hardware-stock.js');
    const formAt = scripts.indexOf('content/float-form.js');
    assert.ok(stockAt >= 0 && stockAt < formAt);
    assert.ok(scripts.includes('lib/i18n-hardware-stock-messages.js'));
    assert.match(read('background/service-worker.js'), /create-task-hardware-stock\.js/);
    assert.match(read('panel/panel.html'), /create-task-hardware-stock\.js/);
    assert.match(read('docs/USER_GUIDE.md'), /项目详情页/);
    assert.match(read('lib/user-guide.js'), /项目详情页/);
  });
});
