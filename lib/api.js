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
  };

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
   * 初始化 API 客户端
   */
  function init(baseUrlOverride, tokenOverride, endpointMapping, userIdOverride) {
    if (baseUrlOverride) baseUrl = baseUrlOverride.replace(/\/+$/, '');
    if (tokenOverride) token = tokenOverride;
    if (userIdOverride) userId = String(userIdOverride);
    if (endpointMapping) {
      endpoints = { ...DEFAULT_ENDPOINTS, ...endpointMapping };
    }
  }

  function setUserId(id) {
    userId = String(id || '');
  }

  function getUserId() {
    return userId;
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

  /**
   * 通用请求方法
   */
  async function request(method, path, body = null) {
    const url = `${baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
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
      throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * 登录 — 获取 Token（密码方式）
   */
  async function login(username, password) {
    const path = buildPath(endpoints.login);
    const data = await request('POST', path, { username, password });
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
   * 登录 — 账号 + 访问令牌
   */
  async function loginWithAccessToken(username, accessToken) {
    if (!username || !String(username).trim()) {
      throw new Error('请填写账号');
    }
    if (!isAccessTokenFormat(accessToken)) {
      throw new Error('访问令牌格式无效，应以 at_ 开头');
    }
    const path = buildPath(endpoints.tokenLogin);
    const data = await request('POST', path, {
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

    console.log('[taskChromePlugin] createTask payload keys:', Object.keys(apiData).join(','));
    return request('POST', buildPath(endpoints.createTask, { companyId, workspaceId }), apiData);
  }

  /**
   * 批量创建任务 — 逐个调用 createTask 端点（无真正的批量 API）
   */
  async function createTasksBatch(tasksData) {
    const results = [];
    const errors = [];
    for (const taskData of tasksData) {
      try {
        const r = await createTask(taskData);
        results.push(r);
      } catch (e) {
        errors.push({ task: taskData.title || '(无标题)', error: e.message });
      }
    }
    return { results, errors, total: tasksData.length, succeeded: results.length };
  }

  function getToken() { return token; }
  function getBaseUrl() { return baseUrl; }

  return {
    init, setEndpointMapping, getEndpointMapping, getDefaultEndpoints,
    setUserId, getUserId, fetchCurrentUser,
    request, login, loginWithAccessToken, isAccessTokenFormat,
    getWorkspaces, getProjects, getMembers, fetchProgressColumns, getBranches,
    getDeliverableTypes, getInstalledImages, getPersonalFeatureParamsConfigs,
    createTask, createTasksBatch,
    getToken, getBaseUrl,
    setOwner: (id) => { endpointOwner = id; },
    getOwner: () => endpointOwner,
  };
})();
