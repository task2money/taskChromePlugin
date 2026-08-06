/**
 * chrome.storage 封装 — 持久化配置与状态
 */

const Storage = {
  _area: chrome.storage.local,
  _session: chrome.storage.session,

  async get(keys) {
    return this._area.get(keys);
  },

  async set(obj) {
    return this._area.set(obj);
  },

  async remove(keys) {
    return this._area.remove(keys);
  },

  // ---- 便捷方法 ----

  /** 获取 API 配置 */
  async getApiConfig() {
    const cfg = await this.get(['baseUrl', 'token', 'tokenExpiresAt', 'tokenIssuedAt']);
    const GATEWAY_DEFAULT = 'https://aidevpush.com';
    // 旧版本可能存储了直连 IP:port 的 baseUrl（如 http://<ip>:4000），
    // 此类地址不代理 /api，自动迁移到默认网关。
    let baseUrl = cfg.baseUrl || GATEWAY_DEFAULT;
    if (/^https?:\/\/\d+\.\d+\.\d+\.\d+:\d+/.test(baseUrl)) {
      baseUrl = GATEWAY_DEFAULT;
      await this.set({ baseUrl: GATEWAY_DEFAULT });
    }
    return {
      baseUrl,
      token: cfg.token || '',
      tokenExpiresAt: cfg.tokenExpiresAt || 0,
      tokenIssuedAt: cfg.tokenIssuedAt || 0,
    };
  },

  /** 保存 API 配置（含 token 过期信息）。空 baseUrl 不覆盖已保存的服务器地址。 */
  async saveApiConfig(baseUrl, token, expiresIn) {
    const payload = { token };
    const trimmedBase = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
    if (trimmedBase) {
      payload.baseUrl = trimmedBase;
    }
    if (expiresIn > 0) {
      const now = Math.floor(Date.now() / 1000);
      payload.tokenIssuedAt = now;
      payload.tokenExpiresAt = now + expiresIn;
    } else if (token) {
      // 新 token 未带 expiresIn：仅保留「尚未过期」的旧 expiry；
      // 已过期的旧时间戳必须清掉，否则 Popup 看似已登录、悬浮面板判定会话过期。
      const existing = await this.get(['tokenExpiresAt', 'tokenIssuedAt']);
      const now = Math.floor(Date.now() / 1000);
      const existingExpiry = Number(existing.tokenExpiresAt) || 0;
      if (existingExpiry > 0 && now < (existingExpiry - 60)) {
        payload.tokenExpiresAt = existingExpiry;
        payload.tokenIssuedAt = existing.tokenIssuedAt || 0;
      } else {
        payload.tokenIssuedAt = 0;
        payload.tokenExpiresAt = 0;
      }
    } else {
      // Clearing token — also clear expiry
      payload.tokenIssuedAt = 0;
      payload.tokenExpiresAt = 0;
    }
    return this.set(payload);
  },

  /** 仅保存服务器地址（登录失败 / 输入过程也要保留） */
  async saveBaseUrl(baseUrl) {
    const trimmed = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
    if (!trimmed) return;
    return this.set({ baseUrl: trimmed });
  },

  /** 清除登录态（token / 凭据），保留服务器地址 */
  async clearAuth() {
    return this.set({
      token: '',
      tokenIssuedAt: 0,
      tokenExpiresAt: 0,
      username: '',
      userId: '',
      memberId: '',
    });
  },

  /** 检查 token 是否已过期 */
  async isTokenExpired() {
    const cfg = await this.get(['token', 'tokenExpiresAt']);
    if (!cfg.token) return true; // no token = expired
    if (!cfg.tokenExpiresAt) return false; // no expiry info = assume valid
    const now = Math.floor(Date.now() / 1000);
    // Consider expired 60 seconds before actual expiry (grace period)
    return now >= (cfg.tokenExpiresAt - 60);
  },

  /**
   * 一次性清理：旧版 saveApiConfig 会把已过期的 tokenExpiresAt 保留到新登录上，
   * 导致 Popup 仍显示已登录、悬浮面板判定会话过期/未登录。
   * 升级到 1.6.1 时对「已过期的 expiry」清零一次；之后以 API 401 为准。
   */
  async migrateStaleTokenExpiryOnce() {
    const flag = await this.get(['authExpiryMigratedV161']);
    if (flag.authExpiryMigratedV161) return false;
    const cfg = await this.get(['token', 'tokenExpiresAt', 'tokenIssuedAt']);
    let cleared = false;
    if (cfg.token && cfg.tokenExpiresAt) {
      const now = Math.floor(Date.now() / 1000);
      if (now >= (cfg.tokenExpiresAt - 60)) {
        await this.set({ tokenExpiresAt: 0, tokenIssuedAt: 0 });
        cleared = true;
      }
    }
    await this.set({ authExpiryMigratedV161: true });
    return cleared;
  },

  /** 获取 token 剩余有效时间（秒），-1 表示无 token，0 表示已过期 */
  async getTokenRemainingSeconds() {
    const cfg = await this.get(['token', 'tokenExpiresAt']);
    if (!cfg.token) return -1;
    if (!cfg.tokenExpiresAt) return Infinity; // no expiry info
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, cfg.tokenExpiresAt - now);
  },

  /**
   * 临近过期提醒文案。
   * - remainingSeconds 无效 / 无过期信息 / ≥15 分钟 → null
   * - <15 分钟 → warn；<5 分钟 → critical
   */
  formatTokenExpiryHint(remainingSeconds) {
    if (remainingSeconds == null) return null;
    if (remainingSeconds === Infinity) return null;
    if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return null;
    const WARN_SEC = 15 * 60;
    const CRITICAL_SEC = 5 * 60;
    if (remainingSeconds >= WARN_SEC) return null;
    const mins = Math.max(1, Math.ceil(remainingSeconds / 60));
    return {
      text: `⏰ ${mins}分钟后过期`,
      level: remainingSeconds < CRITICAL_SEC ? 'critical' : 'warn',
      remainingSeconds,
      minutes: mins,
    };
  },

  /** 保存 Token */
  async saveToken(token) {
    return this.set({ token });
  },

  /** 获取保存的登录凭据 (用户名 + userId + memberId，不含密码) */
  async getCredentials() {
    const cfg = await this.get(['username', 'userId', 'memberId']);
    return { username: cfg.username || '', userId: cfg.userId || '', memberId: cfg.memberId || '' };
  },

  /** 保存用户名、userId 和 memberId */
  async saveCredentials(username, userId, memberId) {
    const payload = { username };
    if (userId) payload.userId = userId;
    if (memberId) payload.memberId = memberId;
    return this.set(payload);
  },

  /** 获取最后选择的工作空间 */
  async getLastWorkspace() {
    const cfg = await this.get(['lastWorkspaceId']);
    return cfg.lastWorkspaceId || null;
  },

  /** 保存最后选择的工作空间 */
  async saveLastWorkspace(workspaceId) {
    return this.set({ lastWorkspaceId: workspaceId });
  },

  /** 获取最后勾选的项目 ID 列表 */
  async getLastProjectIds() {
    const cfg = await this.get(['lastProjectIds']);
    return cfg.lastProjectIds || [];
  },

  /** 保存最后勾选的项目 ID 列表 */
  async saveLastProjectIds(projectIds) {
    return this.set({ lastProjectIds: projectIds });
  },

  /** 获取错误捕获配置 — 自动将旧版仅-错误的配置迁移为全状态码 */
  async getCaptureConfig() {
    const cfg = await this.get(['captureEnabled', 'captureStatusCodes']);
    let statusCodes = cfg.captureStatusCodes;
    // 旧版默认只捕获 4xx/5xx，若不含 2xx 则自动升级为全状态码
    if (!statusCodes || !statusCodes.includes('2xx')) {
      statusCodes = ['2xx', '3xx', '4xx', '5xx', 'canceled'];
    } else if (!statusCodes.includes('canceled')) {
      statusCodes = [...statusCodes, 'canceled'];
    }
    return {
      enabled: cfg.captureEnabled !== undefined ? cfg.captureEnabled : true,
      statusCodes,
    };
  },

  /** 保存错误捕获配置 */
  async saveCaptureConfig(enabled, statusCodes) {
    return this.set({ captureEnabled: enabled, captureStatusCodes: statusCodes });
  },

  /** 获取捕获到的请求列表（会话存储 — 浏览器关闭后自动清空） */
  async getCapturedErrors() {
    const data = await this._session.get(['capturedErrors']);
    return data.capturedErrors || [];
  },

  /** 保存捕获到的请求 */
  async addCapturedError(errorEntry) {
    const errors = await this.getCapturedErrors();
    errors.push({ ...errorEntry, capturedAt: Date.now() });
    // 限制最多存 500 条
    if (errors.length > 500) errors.splice(0, errors.length - 500);
    return this._session.set({ capturedErrors: errors });
  },

  /** 批量添加捕获错误 */
  async addCapturedErrors(entries) {
    const errors = await this.getCapturedErrors();
    for (const e of entries) {
      errors.push({ ...e, capturedAt: Date.now() });
    }
    if (errors.length > 500) errors.splice(0, errors.length - 500);
    return this._session.set({ capturedErrors: errors });
  },

  /** 清空捕获请求列表 */
  async clearCapturedErrors() {
    return this._session.set({ capturedErrors: [] });
  },

  // ---- 任务历史记录 ----

  /** 获取任务创建历史 */
  async getTaskHistory() {
    const data = await this.get(['taskHistory']);
    return data.taskHistory || [];
  },

  /** 添加一条创建记录 */
  async addTaskHistory(entry) {
    const history = await this.getTaskHistory();
    history.push({
      ...entry,
      id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: entry.createdAt || Date.now(),
    });
    if (history.length > 200) history.splice(0, history.length - 200);
    return this.set({ taskHistory: history });
  },

  /** 更新一条历史记录 (如重试结果) */
  async updateTaskHistory(recordId, updates) {
    const history = await this.getTaskHistory();
    const idx = history.findIndex((h) => h.id === recordId);
    if (idx === -1) return;
    history[idx] = { ...history[idx], ...updates, updatedAt: Date.now() };
    return this.set({ taskHistory: history });
  },

  /** 清空历史 */
  async clearTaskHistory() {
    return this.set({ taskHistory: [] });
  },

  /** 获取失败的任务 (用于重试) */
  async getFailedTasks() {
    const history = await this.getTaskHistory();
    return history.filter((h) => h.status === 'failed');
  },

  // ---- API 端点映射 ----

  /** 获取自定义端点映射 */
  async getEndpointMapping() {
    const data = await this.get(['endpointMapping']);
    return data.endpointMapping || {};
  },

  // ---- 请求跟踪配置 ----

  /** 获取请求跟踪配置 — 默认关闭（页面刷新时清空旧请求） */
  async getTrackingConfig() {
    const cfg = await this.get(['trackingEnabled']);
    return { enabled: cfg.trackingEnabled === true };
  },

  /** 保存请求跟踪配置 */
  async saveTrackingConfig(enabled) {
    return this.set({ trackingEnabled: !!enabled });
  },

  /** 保存端点映射 */
  async saveEndpointMapping(mapping) {
    return this.set({ endpointMapping: mapping });
  },

  // ---- 悬浮球配置 ----

  /** 获取悬浮球配置 */
  async getFloatBallConfig() {
    const cfg = await this.get(['floatBallEnabled']);
    // 默认开启
    return { enabled: cfg.floatBallEnabled !== false };
  },

  /** 保存悬浮球配置 */
  async saveFloatBallConfig(enabled) {
    return this.set({ floatBallEnabled: !!enabled });
  },

  /** 获取悬浮球位置 */
  async getFloatBallPosition() {
    const cfg = await this.get(['floatBallX', 'floatBallY']);
    return {
      x: cfg.floatBallX != null ? cfg.floatBallX : null,
      y: cfg.floatBallY != null ? cfg.floatBallY : null,
    };
  },

  /** 保存悬浮球位置 */
  async saveFloatBallPosition(x, y) {
    return this.set({ floatBallX: x, floatBallY: y });
  },

  // ---- 跨页面同步任务描述 ----

  /** 获取跨页面同步任务描述配置 — 默认开启 */
  async getSyncDescriptionConfig() {
    const cfg = await this.get(['syncDescriptionEnabled']);
    return { enabled: cfg.syncDescriptionEnabled !== false };
  },

  /** 保存跨页面同步任务描述配置 */
  async saveSyncDescriptionConfig(enabled) {
    return this.set({ syncDescriptionEnabled: !!enabled });
  },

  // ---- 元素拾取快捷键配置（可自定义；默认 mac ⌘+Shift+X、其他平台 Ctrl+Shift+X）----

  /**
   * 默认快捷键（平台分派）：macOS → 'Command+Shift+X'，其他平台 → 'Ctrl+Shift+X'。
   * 原因：chrome.commands 规范中 Command 修饰键仅 macOS 有效，Windows/Linux 无法绑定
   * ⌘ 组合，故默认按平台取 ⌘ / Ctrl（即用户要求的「默认 cmd+shift+x」在 mac 上的落地）。
   */
  detectDefaultShortcut(nav) {
    return this.isMacPlatform(nav) ? 'Command+Shift+X' : 'Ctrl+Shift+X';
  },

  /** 平台探测：macOS → true（可注入 navigator 供测试） */
  isMacPlatform(nav) {
    const n = nav === undefined ? (typeof navigator !== 'undefined' ? navigator : null) : nav;
    const plat = String(n?.userAgentData?.platform || n?.platform || n?.userAgent || '').toLowerCase();
    return plat.includes('mac');
  },

  /**
   * 非 macOS 默认快捷键（兼容旧版 'ctrl' 迁移的固定值；macOS 默认见 detectDefaultShortcut）。
   * 组合串模型：'Ctrl+Shift+X' / 'Alt+Shift+E' / 'Command+Shift+X' 等，
   * 浏览器级键位经 chrome.commands.update 动态改绑，页内兜底监听跟随同一配置。
   */
  get SHORTCUT_DEFAULT() { return 'Ctrl+Shift+X'; },

  /** 允许的修饰键（对齐 chrome.commands 规范子集；Command 仅限 macOS） */
  _SHORTCUT_MODIFIERS() { return ['Ctrl', 'Alt', 'Command', 'Shift']; },

  /** 允许的按键（chrome.commands 规范：字母/数字/常用功能键/F1-F12） */
  _SHORTCUT_KEYS() {
    return new Set([
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
      'Comma', 'Period', 'Home', 'End', 'PageUp', 'PageDown',
      'Space', 'Insert', 'Delete', 'Up', 'Down', 'Left', 'Right',
      ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
    ]);
  },

  /**
   * 将任意输入归一化为规范快捷键串（如 'Alt+Shift+E'），非法返回 null。
   * 规则对齐 chrome.commands：须含 Ctrl/Alt/Command 之一（Shift 仅可附加），
   * 按键须在允许集内，不允许重复/未知修饰键、不允许仅修饰键。
   */
  normalizeShortcut(raw) {
    if (typeof raw !== 'string') return null;
    const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    let key = parts[parts.length - 1];
    if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
    const mods = parts.slice(0, -1).map((m) => (m.length <= 1 ? m.toUpperCase() : m[0].toUpperCase() + m.slice(1).toLowerCase()));
    const allowedMods = this._SHORTCUT_MODIFIERS();
    if (!this._SHORTCUT_KEYS().has(key)) return null;
    if (mods.length === 0 || mods.length > 2) return null;
    if (!mods.every((m) => allowedMods.includes(m))) return null;
    if (new Set(mods).size !== mods.length) return null; // 不允许重复修饰键
    if (!mods.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Command')) return null;
    return [...mods, key].join('+');
  },

  /**
   * 获取元素拾取快捷键配置 — 返回规范组合串。
   * 旧版 'cmd'/'ctrl' 模式自动迁移：cmd → Command+Shift+X，ctrl → Ctrl+Shift+X；
   * 未设置 / 非法值回退平台默认（mac → Command+Shift+X，其他 → Ctrl+Shift+X）。
   */
  async getElementPickerShortcut() {
    const cfg = await this.get(['elementPickerShortcut']);
    const v = cfg.elementPickerShortcut;
    if (v === 'cmd') return 'Command+Shift+X';
    if (v === 'ctrl') return this.SHORTCUT_DEFAULT;
    return this.normalizeShortcut(v) || this.detectDefaultShortcut();
  },

  /** 保存元素拾取快捷键配置（非法组合抛错，不落盘） */
  async saveElementPickerShortcut(shortcut) {
    const normalized = this.normalizeShortcut(shortcut);
    if (!normalized) throw new Error(`非法快捷键组合: ${String(shortcut)}`);
    await this.set({ elementPickerShortcut: normalized });
    return normalized;
  },

  /**
   * 转换为 chrome.commands.update 使用的平台绑定串。
   * macOS 上普通 'Ctrl' 会被 Chrome 自动转换为 Command 键；要绑定字面 Control
   * 须用 'MacCtrl'（chrome.commands 规范，见 source-driven 文档核对）。
   * 注意：mac 默认键位为 'Command+Shift+X'（Command 修饰键仅 macOS 有效），
   * 用户自定义的 'Ctrl+...' 组合在 mac 上才会触发此转换。
   */
  shortcutToPlatformBinding(shortcut, isMac) {
    const normalized = this.normalizeShortcut(shortcut);
    if (!normalized) return null;
    if (!isMac) return normalized;
    if (normalized.startsWith('Ctrl+')) return `MacCtrl+${normalized.slice(5)}`;
    return normalized;
  },

  /**
   * 严格匹配 keydown 事件与快捷键串（页内兜底监听用）：
   * 串中列出的修饰键必须按下、未列出的修饰键不得按下；按键一致（字母忽略大小写，
   * 'ArrowUp' 等事件键名归一到 Chrome 命令名）。
   */
  matchShortcutKeydown(e, shortcut) {
    if (!e || !shortcut) return false;
    const normalized = this.normalizeShortcut(shortcut);
    if (!normalized) return false;
    const parts = normalized.split('+');
    const keyName = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const k = String(e.key || '');
    let eventKey = k === ' ' ? 'Space' : k.startsWith('Arrow') ? k.slice(5) : k;
    if (eventKey === ',') eventKey = 'Comma';
    if (eventKey === '.') eventKey = 'Period';
    const keyOk = keyName.length === 1
      ? eventKey.toUpperCase() === keyName
      : eventKey === keyName;
    if (!keyOk) return false;
    const pressed = { Ctrl: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey, Command: e.metaKey };
    for (const m of ['Ctrl', 'Alt', 'Shift', 'Command']) {
      if (pressed[m] !== mods.includes(m)) return false;
    }
    return true;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}
