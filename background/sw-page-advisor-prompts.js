/**
 * 侧栏「提示词」下拉的选项出口（服务端驱动）。
 *
 * 侧栏不再维护本地提示词列表：本消息按登录态选区来源——
 *  - 登录：系统目录 + 当前工作空间自定义（lib/page-advisor-prompt-options.js 合并）；
 *  - 未登录：公开目录（无需令牌）。
 * 返回 {ok, skills, defaultSkillId, defaultTitle, partialError}，不含任何提示词正文。
 */

'use strict';

/**
 * @returns {Promise<{ ok: true, skills: object[], defaultSkillId: string, defaultTitle: string,
 *   partialError: boolean }
 *   | { ok: false, error: string, errorCode: string, traceId: string }>}
 */
async function handleLoadPageAdvisorPromptOptions() {
  if (typeof PageAdvisorPromptOptions === 'undefined'
    || typeof PageAdvisorPromptOptions.load !== 'function') {
    return { ok: false, error: 'prompt options not loaded', errorCode: '', traceId: '' };
  }
  try {
    const cfg = await Storage.getApiConfig();
    const baseUrl = String(cfg?.baseUrl || '').trim();
    const token = String(cfg?.token || '').trim();
    const expired = token ? await Storage.isTokenExpired() : false;
    const loggedIn = Boolean(token) && !expired;

    let tenantId = '';
    let workspaceId = '';
    if (loggedIn) {
      const mapping = await Storage.getEndpointMapping();
      const cred = await Storage.getCredentials();
      // getSystemPromptSkills/getPromptSkills 走 API.init 建立的会话（与弹窗同源）。
      API.init(cfg.baseUrl, token, mapping, cred.userId || '');
      if (mapping.owner) API.setOwner(mapping.owner);

      const lastWorkspaceId = await Storage.getLastWorkspace();
      const lastWorkspaceManual = await Storage.getLastWorkspaceManual();
      let workspaces = [];
      try {
        const list = await API.getWorkspaces();
        workspaces = Array.isArray(list) ? list : (list?.results || list?.items || list?.data || []);
      } catch (e) {
        console.warn('[taskChromePlugin] prompt options getWorkspaces:', e?.message || e);
      }
      // 与 sw-page-advisor-pending.js / sw-page-advisor-generate.js 同一个解析入口：
      // 未手选过时跟随平台默认工作空间。
      const resolved = (typeof PageAdvisorDefaults !== 'undefined'
        && PageAdvisorDefaults.resolvePageAdvisorWorkspace)
        ? PageAdvisorDefaults.resolvePageAdvisorWorkspace({
          floatWorkspaceId: '',
          floatCompanyId: '',
          lastWorkspaceId,
          lastWorkspaceManual,
          workspaces,
        })
        : { workspaceId: '', companyId: '', source: '' };
      tenantId = String(resolved.companyId || '').trim();
      workspaceId = String(resolved.workspaceId || '').trim();
    }

    const result = await PageAdvisorPromptOptions.load({
      loggedIn,
      baseUrl,
      tenantId,
      workspaceId,
      api: typeof PageAdvisorAPI !== 'undefined' ? PageAdvisorAPI : null,
      trialApi: typeof PageAdvisorTrialAPI !== 'undefined' ? PageAdvisorTrialAPI : null,
    });
    return {
      ok: true,
      skills: result.skills,
      defaultSkillId: result.defaultSkillId,
      defaultTitle: result.defaultTitle,
      partialError: result.partialError,
    };
  } catch (e) {
    return {
      ok: false,
      // 无服务端文案时回落到公开试用不可用提示（复用既有 i18n 键）。
      error: String(e?.message || '').trim() || tx('paTrialUnavailable'),
      errorCode: String(e?.errorCode || '').trim(),
      traceId: String(e?.traceId || '').trim(),
    };
  }
}
