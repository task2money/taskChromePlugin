/**
 * 多账号管理模块 — 统一管理多个账号槽位。
 *
 * 存储于 chrome.storage.local，由 Service Worker 集中管理，
 * 页面通过 postMessage → content script → SW 间接访问。
 *
 * 账号槽上限 MAX_SAVED_ACCOUNTS = 5，与 taskFE 原逻辑一致。
 */

const MultiAccount = (() => {
  const STORAGE_KEY = 'savedAccounts';
  const ACTIVE_USER_KEY = 'activeUserId';
  const MAX_SAVED_ACCOUNTS = 5;

  // ---- 内部工具 ----

  function normalizeSlot(slot) {
    const userId = String(slot?.userId ?? '').trim();
    const token = String(slot?.token ?? '').trim();
    if (!userId) throw new Error('AccountSlot.userId is required');
    if (!token) throw new Error('AccountSlot.token is required');
    return {
      userId,
      username: String(slot?.username ?? '').trim(),
      avatarUrl: (slot?.avatarUrl != null && String(slot.avatarUrl).trim() !== '')
        ? String(slot.avatarUrl).trim()
        : null,
      token,
      addedAt: Number.isFinite(Number(slot?.addedAt)) ? Number(slot.addedAt) : Date.now(),
    };
  }

  function dedupeByUserId(list) {
    const seen = new Set();
    return list.filter((s) => {
      if (seen.has(s.userId)) return false;
      seen.add(s.userId);
      return true;
    });
  }

  function dedupeByUsername(list) {
    const seen = new Map();
    for (const s of list) {
      if (s.username) {
        const key = s.username.toLowerCase();
        const existing = seen.get(key);
        if (!existing || s.addedAt > existing.addedAt) seen.set(key, s);
      } else {
        seen.set(`__uid__${s.userId}`, s);
      }
    }
    return Array.from(seen.values());
  }

  async function readStorage() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = data[STORAGE_KEY];
    if (!raw) return [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeStorage(list) {
    return chrome.storage.local.set({ [STORAGE_KEY]: list });
  }

  // ---- 公开 API ----

  /** 列出所有已保存账号，自动去重并自愈 */
  async function listSavedAccounts() {
    const raw = await readStorage();
    const normalized = raw.map((s) => {
      try { return normalizeSlot(s); } catch { return null; }
    }).filter(Boolean);

    const deduped = dedupeByUsername(dedupeByUserId(normalized));

    if (deduped.length !== raw.length) {
      try { await writeStorage(deduped); } catch { /* 静默 */ }
    }

    return deduped;
  }

  /** 插入或更新账号槽 */
  async function upsertSavedAccount(slot) {
    const next = normalizeSlot(slot);
    const list = await readStorage();
    const normalized = list.map((s) => {
      try { return normalizeSlot(s); } catch { return null; }
    }).filter(Boolean);

    const existing = normalized.find((s) => s.userId === next.userId);
    const isNew = !existing;
    const filtered = normalized.filter((s) => s.userId !== next.userId);

    if (isNew && filtered.length >= MAX_SAVED_ACCOUNTS) {
      throw new Error(`最多同时保留 ${MAX_SAVED_ACCOUNTS} 个账号`);
    }

    const upserted = isNew ? next : { ...existing, ...next, addedAt: existing.addedAt };
    filtered.push(upserted);
    await writeStorage(filtered);
    return { list: filtered, upserted, isNew };
  }

  /** 删除指定账号 */
  async function removeSavedAccount(userId) {
    const uid = String(userId ?? '').trim();
    if (!uid) throw new Error('userId is required');
    const list = (await listSavedAccounts()).filter((s) => s.userId !== uid);
    await writeStorage(list);

    // 若删除的是当前活跃账号，清除活跃标记
    const active = await getActiveUserId();
    if (active === uid) {
      await clearActiveUserId();
      // 自动切换到剩余第一个账号
      if (list.length > 0) {
        await setActiveUserId(list[0].userId);
        return { list, switchedTo: list[0] };
      }
    }
    return { list, switchedTo: null };
  }

  /** 获取单个账号 */
  async function getSavedAccount(userId) {
    const uid = String(userId ?? '').trim();
    const list = await listSavedAccounts();
    return list.find((s) => s.userId === uid) || null;
  }

  /** 清空所有账号 */
  async function clearSavedAccounts() {
    await writeStorage([]);
    await clearActiveUserId();
  }

  // ---- 活跃账号管理 ----

  /** 获取当前活跃账号的 userId */
  async function getActiveUserId() {
    const data = await chrome.storage.local.get([ACTIVE_USER_KEY]);
    return String(data[ACTIVE_USER_KEY] || '').trim() || null;
  }

  /** 设置当前活跃账号 */
  async function setActiveUserId(userId) {
    const uid = String(userId ?? '').trim();
    if (!uid) throw new Error('userId is required');
    // 验证账号存在
    const account = await getSavedAccount(uid);
    if (!account) throw new Error(`账号 ${uid} 不存在`);
    await chrome.storage.local.set({ [ACTIVE_USER_KEY]: uid });
    return account;
  }

  /** 清除活跃账号标记 */
  async function clearActiveUserId() {
    return chrome.storage.local.remove([ACTIVE_USER_KEY]);
  }

  /** 获取当前活跃账号的完整信息（含 token） */
  async function getActiveAccount() {
    const activeId = await getActiveUserId();
    if (!activeId) {
      // 回退：取最近添加的账号
      const list = await listSavedAccounts();
      if (list.length === 0) return null;
      const latest = list.reduce((a, b) => (a.addedAt > b.addedAt ? a : b));
      await setActiveUserId(latest.userId);
      return latest;
    }
    const account = await getSavedAccount(activeId);
    if (!account) {
      await clearActiveUserId();
      return null;
    }
    return account;
  }

  /** 获取当前活跃 token（供页面 API 调用使用） */
  async function getActiveToken() {
    const account = await getActiveAccount();
    return account?.token || null;
  }

  /** 获取当前活跃 userId */
  async function getActiveCurrentUserId() {
    const account = await getActiveAccount();
    return account?.userId || null;
  }

  return {
    MAX_SAVED_ACCOUNTS,
    listSavedAccounts,
    upsertSavedAccount,
    removeSavedAccount,
    getSavedAccount,
    clearSavedAccounts,
    getActiveUserId,
    setActiveUserId,
    clearActiveUserId,
    getActiveAccount,
    getActiveToken,
    getActiveCurrentUserId,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MultiAccount;
}
