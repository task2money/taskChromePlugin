/**
 * API 客户端 — 与任务管理系统后端通信
 * 所有端点基于 BASE_URL + 可自定义的端点映射
 */

const API = (() => {
  let baseUrl = '';
  let token = '';
  let endpointOwner = '';  // 创建任务时的 owner（CompanyMember.id）

  // 默认端点路径（与 work-panel / 网关约定一致）
  const DEFAULT_ENDPOINTS = {
    login:            '/api/auth/',
    tokenLogin:       '/api/accounts/users/login-with-access-token/',
    workspaces:       '/api/tenant/{companyId}/workspaces/',
    projects:         '/api/tenant/{companyId}/projects/?workspace_id={workspaceId}',
    members:          '/api/tenant/{companyId}/accounts/members/',
    createTask:       '/api/tenant/{companyId}/workspace/{workspaceId}/todos/',
    batchTasks:       '/api/tenant/{companyId}/workspace/{workspaceId}/todos/',
    progressColumns:  '/api/tenant/{companyId}/workspaces/{workspaceId}/progress-system/',
    branches:         '/api/tenant/{companyId}/projects/{projectId}/branches/?repo_url={repoUrl}',
    deliverableTypes: '/api/tenant/{companyId}/manage-deliverable-system/?workspace_id={workspaceId}',
    installedImages:  '/api/tenant/{companyId}/installed-images/',
    personalFeatureParams: '/api/personal/feature-params-configs/',
    pluginScreenshots: '/api/accounts/users/profile/plugin-screenshots/',
    clientIp:         '/api/accounts/users/client-ip/',
    aidevResolve:     '/api/tenant/{companyId}/aidev/resolve?service_id={serviceId}',
  };

  /** 批量创建时复用同一次 client-ip 查询，避免 N 次请求 */
  let batchClientIpFetcher = null;

  let endpoints = { ...DEFAULT_ENDPOINTS };
  let userId = '';
  /** workspaceId → companyId，由 getWorkspaces 填充，供 getProjects/createTask 解析租户 */
  const workspaceCompanyIndex = new Map();

  function rememberWorkspaceCompany(workspaceId, companyId) {
    const wid = String(workspaceId || '').trim();
    const cid = String(companyId || '').trim();
    if (wid && cid) workspaceCompanyIndex.set(wid, cid);
  }

  async function resolveCompanyId(workspaceId) {
    const wid = String(workspaceId || '').trim();
    if (!wid) {
      throw new Error('缺少 workspaceId');
    }
    if (workspaceCompanyIndex.has(wid)) {
      return workspaceCompanyIndex.get(wid);
    }
    await getWorkspaces();
    if (workspaceCompanyIndex.has(wid)) {
      return workspaceCompanyIndex.get(wid);
    }
    throw new Error(`无法解析工作空间 ${wid} 所属租户，请重新加载工作空间列表`);
  }

  /**
   * 初始化 API 客户端。
   * tokenOverride / userIdOverride 传入空字符串时会清空内存中的会话（登录前必须清掉脏 Token）。
   */
  function init(baseUrlOverride, tokenOverride, endpointMapping, userIdOverride) {
    if (baseUrlOverride) baseUrl = baseUrlOverride.replace(/\/+$/, '');
    if (tokenOverride !== undefined && tokenOverride !== null) {
      token = String(tokenOverride);
    }
    if (userIdOverride !== undefined && userIdOverride !== null) {
      userId = String(userIdOverride);
    }
    if (endpointMapping) {
      endpoints = { ...DEFAULT_ENDPOINTS, ...endpointMapping };
    }
  }

  /** 清除内存中的 session（登出 / 重新登录前） */
  function clearSession() {
    token = '';
    userId = '';
  }

  function setUserId(id) {
    userId = String(id || '');
  }

  function getUserId() {
    return userId;
  }

  /**
   * 从 HTTP 错误响应体提取可读信息（taskAuth / DRF 常见字段）
   */
  function extractErrorDetail(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    try {
      const j = JSON.parse(raw);
      if (typeof j.error === 'string' && j.error.trim()) return j.error.trim();
      if (typeof j.detail === 'string' && j.detail.trim()) return j.detail.trim();
      if (typeof j.message === 'string' && j.message.trim()) return j.message.trim();
      if (Array.isArray(j.non_field_errors) && j.non_field_errors.length) {
        return String(j.non_field_errors[0]);
      }
    } catch (_) { /* not json */ }
    return '';
  }

  function formatHttpError(method, path, status, text) {
    const detail = extractErrorDetail(text);
    if (detail) return detail;
    const snippet = String(text || '').trim();
    return snippet
      ? `API ${method} ${path} → ${status}: ${snippet}`
      : `API ${method} ${path} → ${status}`;
  }

  /**
   * 设置/更新端点映射
   */
  function setEndpointMapping(mapping) {
    endpoints = { ...DEFAULT_ENDPOINTS, ...mapping };
  }

  /**
   * 获取当前端点配置
   */
  function getEndpointMapping() {
    return { ...endpoints };
  }

  /**
   * 获取默认端点配置
   */
  function getDefaultEndpoints() {
    return { ...DEFAULT_ENDPOINTS };
  }

  /**
   * 构建路径 — 替换模板变量如 {workspaceId}
   */
  function buildPath(template, params = {}) {
    let path = template;
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }
    return path;
  }

  /**
   * 构建 Authorization 头。
   * - login-with-access-token 返回的 session token → Token <key>（与前端 apiUtils 一致）
   * - 直接携带的 at_* 访问令牌 → Bearer <key>
   */
  function buildAuthorizationHeader(rawToken) {
    const value = String(rawToken || '').trim();
    if (!value) return '';
    if (value.startsWith('at_')) {
      return `Bearer ${value}`;
    }
    return `Token ${value}`;
  }

  function newRequestTraceId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
    } catch (_) { /* ignore */ }
    return `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function resolveTraceId(res, requestTraceId, bodyText) {
    const fromHeader = res?.headers?.get?.('X-Trace-Id') || res?.headers?.get?.('x-trace-id');
    if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
    try {
      const j = bodyText ? JSON.parse(bodyText) : null;
      if (j && typeof j.trace_id === 'string' && j.trace_id.trim()) return j.trace_id.trim();
      if (j && typeof j.traceId === 'string' && j.traceId.trim()) return j.traceId.trim();
    } catch (_) { /* ignore */ }
    return requestTraceId || '';
  }

  function throwHttpError(method, path, status, text, traceId) {
    const err = new Error(formatHttpError(method, path, status, text));
    if (traceId) err.traceId = traceId;
    throw err;
  }

  /**
   * 通用请求方法（带当前 session Authorization）
   */
  async function request(method, path, body = null) {
    const url = `${baseUrl}${path}`;
    const requestTraceId = newRequestTraceId();
    const headers = {
      'Content-Type': 'application/json',
      'X-Trace-Id': requestTraceId,
    };
    const authHeader = buildAuthorizationHeader(token);
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throwHttpError(method, path, res.status, text, resolveTraceId(res, requestTraceId, text));
    }
    return res.json();
  }

  /**
   * 公开接口请求 — 绝不附带 Authorization。
   * 登录类接口若带上过期/无效 Token，部分网关/上游会先鉴权失败（见失败经验 09）。
   */
  async function requestUnauthenticated(method, path, body = null) {
    if (!baseUrl) {
      throw new Error('未配置服务器地址');
    }
    const url = `${baseUrl}${path}`;
    const requestTraceId = newRequestTraceId();
    const headers = {
      'Content-Type': 'application/json',
      'X-Trace-Id': requestTraceId,
    };
    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throwHttpError(method, path, res.status, text, resolveTraceId(res, requestTraceId, text));
    }
    return res.json();
  }

  /**
   * 登录 — 获取 Token（密码方式）
   */
  async function login(username, password) {
    const path = buildPath(endpoints.login);
    const data = await requestUnauthenticated('POST', path, { username, password });
    if (data.token || data.access_token) {
      token = data.token || data.access_token;
    }
    if (data.user?.id) {
      userId = String(data.user.id);
    }
    return data;
  }

  /**
   * 校验访问令牌格式（taskAuth 生成的令牌以 at_ 开头）
   */
  function isAccessTokenFormat(token) {
    return typeof token === 'string' && token.startsWith('at_') && token.length >= 12;
  }

  /**
   * 登录 — 账号 + 访问令牌（不带旧 session Authorization）
   */
  async function loginWithAccessToken(username, accessToken) {
    if (!username || !String(username).trim()) {
      throw new Error('请填写账号');
    }
    if (!isAccessTokenFormat(accessToken)) {
      throw new Error('访问令牌格式无效，应以 at_ 开头');
    }
    const path = buildPath(endpoints.tokenLogin);
    const data = await requestUnauthenticated('POST', path, {
      username: String(username).trim(),
      access_token: accessToken,
    });
    if (data.token || data.access_token) {
      token = data.token || data.access_token;
    }
    if (data.user?.id) {
      userId = String(data.user.id);
    }
    return data;
  }

  /**
   * 获取当前用户信息（含 companies 列表）
   */
  async function fetchCurrentUser() {
    if (!userId) {
      throw new Error('缺少 userId，请重新登录');
    }
    return request('GET', `/api/user/${encodeURIComponent(userId)}/accounts/users/me/`);
  }

  /**
   * 获取工作空间列表
   * @param {string} [companyId] 指定租户时只拉该租户；省略则聚合用户全部租户
   */
  async function getWorkspaces(companyId) {
    if (companyId) {
      const data = await request('GET', buildPath(endpoints.workspaces, { companyId }));
      const rows = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      for (const ws of rows) {
        rememberWorkspaceCompany(ws.id || ws._id, companyId);
      }
      return rows;
    }

    const user = await fetchCurrentUser();
    const companies = Array.isArray(user.companies) ? user.companies : [];
    const merged = [];

    for (const company of companies) {
      const cid = String(company.id || company.company_id || '').trim();
      if (!cid) continue;
      const data = await request('GET', buildPath(endpoints.workspaces, { companyId: cid }));
      const rows = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      for (const ws of rows) {
        const wid = ws.id || ws._id;
        rememberWorkspaceCompany(wid, cid);
        merged.push({
          ...ws,
          company_id: ws.company_id || ws.companyId || cid,
          company_name: ws.company_name || ws.companyName || company.name,
        });
      }
    }

    return merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
  }

  /**
   * 获取指定工作空间的项目列表
   * @param {string} workspaceId
   * @param {string} [companyId] 可省略，将从工作空间缓存或重新拉取列表解析
   */
  async function getProjects(workspaceId, companyId) {
    const cid = companyId ? String(companyId) : await resolveCompanyId(workspaceId);
    return request('GET', buildPath(endpoints.projects, { companyId: cid, workspaceId }));
  }

  /**
   * 获取公司成员列表
   */
  async function getMembers(companyId) {
    return request('GET', buildPath(endpoints.members, { companyId }));
  }

  /**
   * 获取工作空间的进度列列表
   * 返回 { columns: [{id, name, order}] }
   */
  async function fetchProgressColumns(companyId, workspaceId) {
    return request('GET', buildPath(endpoints.progressColumns, { companyId, workspaceId }));
  }

  /**
   * 获取项目 Git 仓库的分支列表
   * 返回 { branches: [...], error: null }
   */
  async function getBranches(companyId, projectId, repoUrl) {
    return request('GET', buildPath(endpoints.branches, { companyId, projectId, repoUrl }));
  }

  /**
   * 获取工作空间交付物类别（current_deliverable_objs）
   */
  async function getDeliverableTypes(companyId, workspaceId) {
    return request('GET', buildPath(endpoints.deliverableTypes, { companyId, workspaceId }));
  }

  /**
   * 获取租户已安装镜像列表
   */
  async function getInstalledImages(companyId) {
    return request('GET', buildPath(endpoints.installedImages, { companyId }));
  }

  /**
   * 获取个人环境变量参数配置列表
   */
  async function getPersonalFeatureParamsConfigs() {
    return request('GET', endpoints.personalFeatureParams);
  }

  /**
   * 查询边缘看到的用户公网 IP（taskAuth client-ip）。
   * @returns {Promise<string>}
   */
  async function fetchPublicClientIp() {
    const path = buildPath(endpoints.clientIp);
    const data = await request('GET', path);
    const ip = String(data?.ip || '').trim();
    if (!ip) {
      throw new Error('client-ip empty');
    }
    return ip;
  }

  async function resolveClientIpForAutoRun() {
    if (typeof batchClientIpFetcher === 'function') {
      return batchClientIpFetcher();
    }
    return fetchPublicClientIp();
  }

  /**
   * 创建任务 (单个) — 对齐 work-panel POST /todos/ 字段
   * 接受插件表单字段或已构建的 API payload；优先走 CreateTaskPayload 规范化
   */
  async function createTask(taskData) {
    const Payload = (typeof CreateTaskPayload !== 'undefined') ? CreateTaskPayload : null;
    let apiData;
    if (Payload && (taskData?.workspaceId || taskData?.projectIds || taskData?.workBranch != null)) {
      apiData = Payload.buildCreateTaskPayload({
        ...taskData,
        owner: taskData.owner || endpointOwner,
      });
    } else {
      apiData = { ...taskData };
      if (apiData.workspaceId && !apiData.workspace_id) {
        apiData.workspace_id = apiData.workspaceId;
      }
      delete apiData.workspaceId;
      if (Array.isArray(apiData.projectIds) && !apiData.projects) {
        apiData.projects = Payload
          ? Payload.buildProjectsFromSelection({
            projectIds: apiData.projectIds,
            projectsList: apiData.projectsList || [],
            workBranch: apiData.branch_strategy?.work_branch_name || '',
            baseBranch: apiData.baseBranch || '',
          })
          : apiData.projectIds.map((project_id) => ({
            project_id,
            repo_index: 0,
            base_branch: 'main',
            target_branch: '',
          }));
      }
      delete apiData.projectIds;
      delete apiData.projectsList;
      delete apiData.baseBranch;
      delete apiData.workBranch;
      delete apiData.mergeTarget;
      delete apiData.source;
      delete apiData.sourceUrl;
      delete apiData.sourceTitle;
      if (Payload) {
        apiData.priority = Payload.normalizePriority(apiData.priority);
      }
    }

    if (endpointOwner && !apiData.owner) {
      apiData.owner = endpointOwner;
    }

    const workspaceId = String(apiData.workspace_id || '').trim();
    if (!workspaceId) {
      throw new Error('缺少 workspaceId');
    }
    const companyId = String(
      apiData.company_id || apiData.companyId || await resolveCompanyId(workspaceId)
    ).trim();
    delete apiData.company_id;
    delete apiData.companyId;
    apiData.workspace_id = workspaceId;

    // auto_run → 后端异步 start-vm-auto；主动查 client-ip 写入 body（不依赖创建请求 XFF）
    if (typeof ClientPublicIp !== 'undefined' && ClientPublicIp.attachClientPublicIpForAutoRun) {
      apiData = await ClientPublicIp.attachClientPublicIpForAutoRun(
        apiData,
        () => resolveClientIpForAutoRun(),
      );
    }

    console.log('[taskChromePlugin] createTask payload keys:', Object.keys(apiData).join(','));
    return request('POST', buildPath(endpoints.createTask, { companyId, workspaceId }), apiData);
  }

  /**
   * 批量创建任务 — 逐个调用 createTask 端点（无真正的批量 API）
   */
  async function createTasksBatch(tasksData) {
    const results = [];
    const errors = [];
    let resolvedBatchIp;
    batchClientIpFetcher = async () => {
      if (resolvedBatchIp !== undefined) return resolvedBatchIp;
      try {
        resolvedBatchIp = await fetchPublicClientIp();
      } catch (e) {
        console.warn('[taskChromePlugin] batch client-ip 查询失败:', e);
        resolvedBatchIp = '';
      }
      return resolvedBatchIp;
    };
    try {
      for (const taskData of tasksData) {
        try {
          const r = await createTask(taskData);
          results.push(r);
        } catch (e) {
          errors.push({ task: taskData.title || '(无标题)', error: e.message });
        }
      }
    } finally {
      batchClientIpFetcher = null;
    }
    return { results, errors, total: tasksData.length, succeeded: results.length };
  }

  /**
   * 上传插件元素截图（multipart），返回 { url }
   * @param {string} dataUrl data:image/jpeg;base64,...
   */
  async function uploadPluginScreenshot(dataUrl) {
    const raw = String(dataUrl || '');
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(raw);
    if (!m) throw new Error('截图 dataUrl 格式无效');
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = mime.includes('png') ? 'png' : (mime.includes('webp') ? 'webp' : 'jpg');
    const blob = new Blob([bytes], { type: mime });
    const form = new FormData();
    form.append('file', blob, `element-shot.${ext}`);

    const path = buildPath(endpoints.pluginScreenshots);
    const url = `${baseUrl}${path}`;
    const requestTraceId = newRequestTraceId();
    const headers = { 'X-Trace-Id': requestTraceId };
    const authHeader = buildAuthorizationHeader(token);
    if (authHeader) headers.Authorization = authHeader;

    const res = await fetch(url, { method: 'POST', headers, body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throwHttpError('POST', path, res.status, text, resolveTraceId(res, requestTraceId, text));
    }
    return res.json();
  }

  /**
   * 按 service_id / tag 反查租户内所有匹配项目（聚合用户全部 company）
   * @returns {Promise<{ matches: object[] }>}
   */
  async function resolveAidevMeta({ serviceId, tag } = {}) {
    const sid = String(serviceId || '').trim();
    const tagStr = String(tag || '').trim();
    if (!sid && !tagStr) {
      throw new Error('service_id 或 tag 至少提供一个');
    }

    const user = await fetchCurrentUser();
    const companies = Array.isArray(user.companies) ? user.companies : [];
    const merged = [];

    for (const company of companies) {
      const cid = String(company.id || company.company_id || '').trim();
      if (!cid) continue;

      let path = buildPath(endpoints.aidevResolve, { companyId: cid, serviceId: sid || '' });
      if (tagStr) {
        path += `&tag=${encodeURIComponent(tagStr)}`;
      }

      try {
        const data = await request('GET', path);
        const rows = Array.isArray(data?.matches) ? data.matches : [];
        merged.push(...rows);
      } catch (e) {
        console.warn('[taskChromePlugin] resolveAidevMeta company', cid, e.message);
      }
    }

    return { matches: merged };
  }

  function getToken() { return token; }
  function getBaseUrl() { return baseUrl; }

  return {
    init, clearSession, setEndpointMapping, getEndpointMapping, getDefaultEndpoints,
    setUserId, getUserId, fetchCurrentUser,
    request, requestUnauthenticated, login, loginWithAccessToken, isAccessTokenFormat,
    extractErrorDetail, formatHttpError, buildAuthorizationHeader,
    getWorkspaces, getProjects, getMembers, fetchProgressColumns, getBranches,
    getDeliverableTypes, getInstalledImages, getPersonalFeatureParamsConfigs,
    createTask, createTasksBatch, uploadPluginScreenshot, fetchPublicClientIp,
    resolveAidevMeta,
    getToken, getBaseUrl,
    setOwner: (id) => { endpointOwner = id; },
    getOwner: () => endpointOwner,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
