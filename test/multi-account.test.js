/**
 * multi-account.js 单元测试
 * 使用 mock chrome.storage API 模拟浏览器环境
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Mock chrome.storage.local
const storageData = {};
const mockChromeStorage = {
  local: {
    get: async (keys) => {
      const result = {};
      if (Array.isArray(keys)) {
        for (const k of keys) {
          if (k in storageData) result[k] = storageData[k];
        }
      } else if (typeof keys === 'object') {
        for (const k of Object.keys(keys)) {
          if (k in storageData) result[k] = storageData[k];
          else result[k] = keys[k];
        }
      }
      return result;
    },
    set: async (obj) => {
      Object.assign(storageData, obj);
    },
    remove: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete storageData[k];
    },
  },
};

globalThis.chrome = { storage: mockChromeStorage };

// Load the module
const MultiAccount = require('../lib/multi-account.js');

describe('MultiAccount', () => {
  beforeEach(() => {
    for (const k of Object.keys(storageData)) delete storageData[k];
  });

  describe('listSavedAccounts', () => {
    it('returns empty array when no accounts stored', async () => {
      const list = await MultiAccount.listSavedAccounts();
      assert.deepStrictEqual(list, []);
    });

    it('returns stored accounts with dedup', async () => {
      await chrome.storage.local.set({
        savedAccounts: [
          { userId: '1', token: 'tok1', username: 'Alice', addedAt: 100 },
          { userId: '1', token: 'tok1b', username: 'Alice', addedAt: 200 }, // dup userId
        ],
      });
      const list = await MultiAccount.listSavedAccounts();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].userId, '1');
    });

    it('dedupes by username case-insensitively', async () => {
      await chrome.storage.local.set({
        savedAccounts: [
          { userId: '1', token: 'tok1', username: 'Alice', addedAt: 100 },
          { userId: '2', token: 'tok2', username: 'alice', addedAt: 200 },
        ],
      });
      const list = await MultiAccount.listSavedAccounts();
      // The more recent one survives
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].userId, '2');
    });

    it('self-heals corrupted storage', async () => {
      await chrome.storage.local.set({ savedAccounts: 'not-an-array' });
      const list = await MultiAccount.listSavedAccounts();
      assert.deepStrictEqual(list, []);
    });
  });

  describe('upsertSavedAccount', () => {
    it('adds a new account', async () => {
      const result = await MultiAccount.upsertSavedAccount({
        userId: '1', token: 'tok1', username: 'Alice',
      });
      assert.strictEqual(result.isNew, true);
      assert.strictEqual(result.upserted.userId, '1');
      assert.strictEqual(result.list.length, 1);
    });

    it('updates an existing account', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1', username: 'Alice' });
      const result = await MultiAccount.upsertSavedAccount({
        userId: '1', token: 'tok2', username: 'Alice2',
      });
      assert.strictEqual(result.isNew, false);
      assert.strictEqual(result.upserted.token, 'tok2');
      assert.strictEqual(result.upserted.username, 'Alice2');
      assert.strictEqual(result.list.length, 1);
    });

    it('throws when exceeding MAX_SAVED_ACCOUNTS', async () => {
      for (let i = 1; i <= 5; i++) {
        await MultiAccount.upsertSavedAccount({ userId: String(i), token: `tok${i}` });
      }
      await assert.rejects(
        () => MultiAccount.upsertSavedAccount({ userId: '6', token: 'tok6' }),
        /最多同时保留/,
      );
    });

    it('throws when userId missing', async () => {
      await assert.rejects(
        () => MultiAccount.upsertSavedAccount({ token: 'tok' }),
        /userId is required/,
      );
    });

    it('throws when token missing', async () => {
      await assert.rejects(
        () => MultiAccount.upsertSavedAccount({ userId: '1' }),
        /token is required/,
      );
    });
  });

  describe('removeSavedAccount', () => {
    it('removes an account and switches if was active', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      await MultiAccount.upsertSavedAccount({ userId: '2', token: 'tok2' });
      await MultiAccount.setActiveUserId('1');
      const result = await MultiAccount.removeSavedAccount('1');
      assert.strictEqual(result.list.length, 1);
      assert.strictEqual(result.list[0].userId, '2');
      assert.strictEqual(result.switchedTo.userId, '2');
    });

    it('throws when userId missing', async () => {
      await assert.rejects(
        () => MultiAccount.removeSavedAccount(''),
        /userId is required/,
      );
    });
  });

  describe('pruneSavedAccounts（过期槽位清理兜底，OPT-20260806-036 单账号语义）', () => {
    it('no-op when ids empty', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      const result = await MultiAccount.pruneSavedAccounts([]);
      assert.strictEqual(result.list.length, 1);
      assert.deepStrictEqual(result.removed, []);
      const list = await MultiAccount.listSavedAccounts();
      assert.strictEqual(list.length, 1);
    });

    it('removes matching accounts and keeps others', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1', username: 'Alice' });
      await MultiAccount.upsertSavedAccount({ userId: '2', token: 'tok2', username: 'Bob' });
      await MultiAccount.upsertSavedAccount({ userId: '3', token: 'tok3', username: 'Carol' });
      const result = await MultiAccount.pruneSavedAccounts(['1', '3']);
      assert.strictEqual(result.list.length, 1);
      assert.strictEqual(result.list[0].userId, '2');
      assert.deepStrictEqual(result.removed.map((s) => s.userId), ['1', '3']);
    });

    it('ignores unknown/nonexistent ids', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      const result = await MultiAccount.pruneSavedAccounts(['999', '  ', '']);
      assert.strictEqual(result.list.length, 1);
      assert.deepStrictEqual(result.removed, []);
    });

    it('switches active account to first remaining when active is pruned', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      await MultiAccount.upsertSavedAccount({ userId: '2', token: 'tok2' });
      await MultiAccount.setActiveUserId('1');
      await MultiAccount.pruneSavedAccounts(['1']);
      const activeId = await MultiAccount.getActiveUserId();
      assert.strictEqual(activeId, '2');
    });

    it('clears active marker when all accounts pruned', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      await MultiAccount.setActiveUserId('1');
      await MultiAccount.pruneSavedAccounts(['1']);
      const list = await MultiAccount.listSavedAccounts();
      assert.deepStrictEqual(list, []);
      assert.strictEqual(await MultiAccount.getActiveUserId(), null);
    });

    it('dedupes ids in input', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      const result = await MultiAccount.pruneSavedAccounts(['1', '1', '1']);
      assert.strictEqual(result.removed.length, 1);
      assert.deepStrictEqual(result.list, []);
    });

    it('does not touch active marker when pruning inactive accounts', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1' });
      await MultiAccount.upsertSavedAccount({ userId: '2', token: 'tok2' });
      await MultiAccount.setActiveUserId('1');
      await MultiAccount.pruneSavedAccounts(['2']);
      assert.strictEqual(await MultiAccount.getActiveUserId(), '1');
    });
  });

  describe('getActiveAccount / getActiveToken', () => {
    it('returns null when no accounts', async () => {
      const account = await MultiAccount.getActiveAccount();
      assert.strictEqual(account, null);
    });

    it('returns active account', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok1', username: 'Bob' });
      await MultiAccount.setActiveUserId('1');
      const account = await MultiAccount.getActiveAccount();
      assert.strictEqual(account.userId, '1');
      assert.strictEqual(account.token, 'tok1');
    });

    it('getActiveToken returns token string', async () => {
      await MultiAccount.upsertSavedAccount({ userId: '1', token: 'secret' });
      await MultiAccount.setActiveUserId('1');
      const token = await MultiAccount.getActiveToken();
      assert.strictEqual(token, 'secret');
    });
  });

  describe('normalizeSlot edge cases', () => {
    it('accepts numeric userId as string', async () => {
      const result = await MultiAccount.upsertSavedAccount({ userId: 42, token: 'tok' });
      assert.strictEqual(result.upserted.userId, '42');
    });

    it('defaults addedAt to Date.now()', async () => {
      const before = Date.now();
      const result = await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok' });
      assert.ok(result.upserted.addedAt >= before);
    });

    it('preserves explicit addedAt', async () => {
      const result = await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok', addedAt: 100 });
      assert.strictEqual(result.upserted.addedAt, 100);
    });

    it('handles null/empty avatarUrl', async () => {
      const r1 = await MultiAccount.upsertSavedAccount({ userId: '1', token: 'tok', avatarUrl: '' });
      assert.strictEqual(r1.upserted.avatarUrl, null);
      const r2 = await MultiAccount.upsertSavedAccount({ userId: '2', token: 'tok', avatarUrl: null });
      assert.strictEqual(r2.upserted.avatarUrl, null);
    });
  });
});
