/**
 * ADR-0138 — probe supported_models for edge register/heartbeat.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  probeBuiltinEdgeSupportedModels,
  CANONICAL_MODEL,
} = require('../lib/builtin-edge-supported-models.js');

describe('probeBuiltinEdgeSupportedModels', () => {
  it('returns builtin-edge when availability is available', async () => {
    const models = await probeBuiltinEdgeSupportedModels(
      {},
      { probe: async () => 'available' },
      'zh-CN',
    );
    assert.deepEqual(models, [CANONICAL_MODEL]);
  });

  it('returns builtin-edge when downloadable', async () => {
    const models = await probeBuiltinEdgeSupportedModels(
      {},
      { probe: async () => 'downloadable' },
    );
    assert.deepEqual(models, [CANONICAL_MODEL]);
  });

  it('returns empty when unavailable', async () => {
    const models = await probeBuiltinEdgeSupportedModels(
      {},
      { probe: async () => 'unavailable' },
    );
    assert.deepEqual(models, []);
  });

  it('returns empty without LanguageModel', async () => {
    const models = await probeBuiltinEdgeSupportedModels(null, { probe: async () => 'available' });
    assert.deepEqual(models, []);
  });
});
