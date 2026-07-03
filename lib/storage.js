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
    const cfg = await this.get(['baseUrl', 'token']);
    return {
      baseUrl: cfg.baseUrl || 'http://183.250.1.132:4000',
      token: cfg.token || '',
    };
  },

  /** 保存 API 配置 */
  async saveApiConfig(baseUrl, token) {
    return this.set({ baseUrl, token });
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
      statusCodes = ['2xx', '3xx', '4xx', '5xx'];
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
};
