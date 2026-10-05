'use strict';

// OPT-20261005-002: 硬件档位决定建议条数与上下文占比。
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const HW = require('../lib/page-advisor-hardware-tier.js');
const Fit = require('../lib/page-advisor-builtin-fit.js');
const Suggest = require('../lib/page-advisor-builtin-suggest.js');

describe('PageAdvisorHardwareTier', () => {
  it('按 deviceMemory 估算档位，未知按中档', () => {
    assert.equal(HW.estimateTier(null), 'mid');
    assert.equal(HW.estimateTier({}), 'mid');
    assert.equal(HW.estimateTier({ deviceMemory: 2 }), 'low');
    assert.equal(HW.estimateTier({ deviceMemory: 4 }), 'low');
    assert.equal(HW.estimateTier({ deviceMemory: 6 }), 'mid');
    assert.equal(HW.estimateTier({ deviceMemory: 8 }), 'high');
    assert.equal(HW.estimateTier({ deviceMemory: 16 }), 'high');
  });

  it('档位预算：低档更少条数与更紧预算', () => {
    assert.deepEqual(HW.budgetForTier('low'), { maxItems: 3, budgetFactor: 0.5 });
    assert.deepEqual(HW.budgetForTier('mid'), { maxItems: 5, budgetFactor: 0.6 });
    assert.deepEqual(HW.budgetForTier('high'), { maxItems: 8, budgetFactor: 0.65 });
    assert.deepEqual(HW.budgetForTier('nonsense'), HW.budgetForTier('mid'));
  });

  it('schemaForTier 仅覆盖 maxItems', () => {
    const base = { type: 'array', maxItems: 8, items: { type: 'object' } };
    const low = HW.schemaForTier('low', base);
    assert.equal(low.maxItems, 3);
    assert.equal(low.type, 'array');
    assert.equal(low.items, base.items);
    // 不改动原 schema
    assert.equal(base.maxItems, 8);
  });

  it('inputBudget 支持按占比收紧，非法占比回退默认', () => {
    assert.equal(Fit.inputBudget(1000, 0.5), 500);
    assert.equal(Fit.inputBudget(1000), 650);
    assert.equal(Fit.inputBudget(1000, 0), 650);
    assert.equal(Fit.inputBudget(0, 0.5), Infinity);
    assert.equal(Fit.inputBudget(10, 0.5), 256);
  });

  it('suggest.resolveHardwareTier 优先 opts.hardwareTier', () => {
    assert.equal(Suggest.resolveHardwareTier({ hardwareTier: 'low' }), 'low');
    assert.equal(Suggest.resolveHardwareTier({ hardwareTier: 'HIGH' }), 'high');
    assert.equal(Suggest.resolveHardwareTier({ hardwareTier: 'weird' }), 'mid');
  });
});
