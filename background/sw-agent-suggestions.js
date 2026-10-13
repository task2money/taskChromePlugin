/**
 * 侧边栏「给当前网页生成建议」：生成 → 落成当前网页的优化贴（ADR-0167）。
 *
 * 落点由服务端判定：域名绑到某个项目的「全站自动优化」就挂那个项目，
 * 没绑定就挂默认项目。插件不猜落点，只把服务端回报的项目名显示给用户。
 */

'use strict';

/** 生成结果的展示文案：第一条当标题，多条时把详情编号并列。 */
function agentSuggestionCopy(suggestions, pageTitle) {
  const list = (Array.isArray(suggestions) ? suggestions : []).filter(Boolean);
  const first = list[0] || {};
  const details = list
    .map((s) => String(s?.detail || s?.summary || '').trim())
    .filter(Boolean);
  return {
    title: String(first.title || '').trim() || String(pageTitle || '').trim(),
    summary: String(first.summary || '').trim(),
    detail: details.length === 1
      ? details[0]
      : details.map((text, i) => `${i + 1}. ${text}`).join('\n'),
  };
}

/**
 * 生成结果 → 服务端 OfflineSuggestion 行。
 * 只带能再次定位的锚点字段（会话期 nid 换了页面就失效，不上行）。
 */
function agentSuggestionRows(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : [])
    .map((s, i) => ({
      id: String(s?.id || `s${i + 1}`),
      title: String(s?.title || '').trim(),
      summary: String(s?.summary || '').trim(),
      detail: String(s?.detail || '').trim(),
      dom_id: String(s?.dom_id || '').trim(),
      testid: String(s?.testid || '').trim(),
      css_path: String(s?.css_path || '').trim(),
      visible_text: String(s?.visible_text || '').trim(),
      anchor_text: String(s?.anchor_text || '').trim(),
      html_snippet: String(s?.html_snippet || '').trim(),
      landmark: String(s?.landmark || '').trim(),
    }))
    .filter((row) => row.title || row.summary || row.detail);
}

/** 下拉里选中的那条提示词；选「默认提示词」时返回 null。 */
async function loadAgentSuggestionSkill(skillId) {
  const id = String(skillId || '').trim();
  if (!id || typeof PageAdvisorPromptSkills === 'undefined') return null;
  try {
    const store = await PageAdvisorPromptSkills.loadFromStorage();
    const skills = Array.isArray(store?.skills) ? store.skills : [];
    return skills.find((s) => String(s?.id || '') === id) || null;
  } catch (e) {
    console.warn('[taskChromePlugin] load prompt skill:', e?.message || e);
    return null;
  }
}

/** 默认提示词：与 Alt+Z 同源（本机已激活技能，缺则补拉系统目录）。 */
async function loadAgentSuggestionDefaultSkill() {
  const cfg = await Storage.getApiConfig();
  const expired = cfg.token ? await Storage.isTokenExpired() : false;
  return loadDirectLlmSkill(!!(cfg.token && !expired));
}

/** 落贴租户：页面上下文给了（站点上选过工作空间）就用它，否则按列表同源的口径解析。 */
async function resolveAgentSuggestionTenant(pageTenantId) {
  const fromPage = String(pageTenantId || '').trim();
  if (fromPage) return fromPage;
  const tenant = await resolveTenantIdForSitePending();
  return tenant.ok ? String(tenant.tenantId || '') : '';
}

/**
 * @param {{ skillId?: string, promptTendency?: string }} message
 * @returns {Promise<{ success: boolean, error?: string, errorCode?: string, traceId?: string,
 *   created?: boolean, postId?: string, taskId?: string, projectId?: string, projectName?: string,
 *   workspaceId?: string, matched?: boolean, matchedBy?: string, count?: number, links?: any[] }>}
 */
async function handleGenerateAgentSuggestionsForActiveTab(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id || !tab.url) return { success: false, error: tx('swNoActiveTab') };

  const skill = await loadAgentSuggestionSkill(message?.skillId);
  const result = await generatePageAdvisorSuggestions(tab.id, skill
    ? { skill, attachAnchors: true }
    : { skillLoader: () => loadAgentSuggestionDefaultSkill(), attachAnchors: true });

  if (!result.ok) {
    return {
      success: false,
      error: result.error,
      errorCode: result.errorCode || '',
      ...(result.traceId ? { traceId: result.traceId } : {}),
      ...(result.links ? { links: result.links } : {}),
    };
  }

  const tenantId = await resolveAgentSuggestionTenant(result.tenantId);
  if (!tenantId) return { success: false, error: tx('agentSuggestionsLogin') };

  const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
  const rawUrl = String(result.pageUrl || tab.url || '');
  const pageUrl = Pending?.pageUrlForAgentSuggestions
    ? Pending.pageUrlForAgentSuggestions(rawUrl)
    : rawUrl;
  const copy = agentSuggestionCopy(result.suggestions, result.pageTitle);
  const rows = agentSuggestionRows(result.suggestions);
  const idempotencyKey = (typeof ClickGuard !== 'undefined' && ClickGuard.newIdempotencyKey)
    ? ClickGuard.newIdempotencyKey()
    : `agent-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  let data;
  try {
    data = await PageAdvisorAPI.createPendingSuggestion(tenantId, {
      page_url: pageUrl,
      title: copy.title,
      summary: copy.summary,
      detail: copy.detail,
      prompt_tendency: String(skill?.tendency || message?.promptTendency || '').trim(),
      suggestions: rows,
    }, idempotencyKey);
  } catch (e) {
    return {
      success: false,
      error: e?.message || tx('agentSuggestionsGenerateFail'),
      errorCode: e?.errorCode || '',
      ...(e?.traceId ? { traceId: e.traceId } : {}),
    };
  }

  const postId = String(data?.suggestion_id || data?.suggestionId || '').trim();
  console.info('[taskChromePlugin] agent_suggestion_posted', {
    tenantId,
    postId,
    created: data?.created !== false,
    matched: !!data?.matched,
    matchedBy: String(data?.matched_by || ''),
    count: rows.length,
  });
  return {
    success: true,
    created: data?.created !== false,
    suggestionId: postId,
    postId,
    taskId: String(data?.task_id || ''),
    projectId: String(data?.project_id || ''),
    projectName: String(data?.project_name || ''),
    workspaceId: String(data?.workspace_id || ''),
    matched: !!data?.matched,
    matchedBy: String(data?.matched_by || ''),
    count: rows.length,
    ...(data?.trace_id ? { traceId: String(data.trace_id) } : {}),
  };
}
