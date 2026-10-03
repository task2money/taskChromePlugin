const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FP = require('../lib/plugin-install-fingerprint.js');

function memStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    get(keys, cb) {
      const out = {};
      for (const k of keys) out[k] = data[k];
      cb(out);
    },
    set(obj, cb) {
      Object.assign(data, obj);
      cb();
    },
    _data: data,
  };
}

describe('PluginInstallFingerprint', () => {
  it('collectBrowserFingerprintSeed 拼接稳定字段', () => {
    const seed = FP.collectBrowserFingerprintSeed(
      {
        userAgent: 'Mozilla/5.0',
        language: 'zh-CN',
        languages: ['zh-CN', 'en'],
        platform: 'Linux x86_64',
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
      },
      { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
      { timeZone: 'Asia/Shanghai', runtimeId: 'ext-id' },
    );
    assert.match(seed, /Mozilla\/5\.0/);
    assert.match(seed, /zh-CN,en/);
    assert.match(seed, /Asia\/Shanghai/);
    assert.match(seed, /ext-id/);
  });

  it('相同 seed+entropy 生成相同指纹；不同 entropy 不同', () => {
    const a = FP.buildInstallFingerprintId('seed-a', 'abc12345');
    const b = FP.buildInstallFingerprintId('seed-a', 'abc12345');
    const c = FP.buildInstallFingerprintId('seed-a', 'zzzzzzzz');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^pf_[0-9a-f]{16}_[a-z0-9]{8}$/);
  });

  it('ensure 首次写入并复用', async () => {
    const storage = memStorage();
    const env = {
      navigator: { userAgent: 'UA', language: 'en', platform: 'Mac' },
      screen: { width: 1, height: 2 },
      timeZone: 'UTC',
      runtimeId: 'rid',
      entropy: 'deadbeef',
    };
    const first = await FP.ensurePluginInstallFingerprint(storage, env);
    const second = await FP.ensurePluginInstallFingerprint(storage, {
      ...env,
      entropy: 'otherone',
    });
    assert.equal(first, second);
    assert.equal(storage._data[FP.STORAGE_KEY], first);
    assert.equal(await FP.getPluginInstallFingerprint(storage), first);
  });
});
