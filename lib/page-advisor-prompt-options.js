/**
 * 侧栏「提示词」下拉的服务端选项源。
 *
 * 登录态：系统目录（GET /api/page-advisor/v1/system-prompt-skills/）+ 工作空间
 *        提示词（GET .../tenant_id/{tid}/workspace_id/{wid}/prompt-skills/，含目录副本），
 *        两份并发拉取；工作空间里的目录副本按 id 去重，目录条目胜出。
 * 未登录：公开目录（GET /api/page-advisor/v1/page-trials/prompt-skills/，无需令牌）。
 *
 * 输出只投影下拉需要的元数据（id/title/tendency/runtime/source/readonly）。
 * 系统目录与工作空间响应都带提示词正文，正文绝不进入本模块的返回值或日志。
 */

'use strict';

const PageAdvisorPromptOptions = (() => {
  // Secret-Hardcode-OK: chrome.storage 键名，不是凭据
  const SELECTED_KEY = 'pageAdvisorSelectedPromptId';

  // 单一槽位的内存快照：key = `${loggedIn}|${tenantId}|${workspaceId}`。
  // 身份一变就整体丢弃，SW 生命周期内不会按用户/空间累积。
  let cache = null;

  /** SW / 扩展页用 lib/storage.js 的全局；单测可注入 globalThis.Storage。 */
  function storageApi() {
    if (typeof Storage !== 'undefined' && Storage
      && typeof Storage.get === 'function' && typeof Storage.set === 'function') {
      return Storage;
    }
    return null;
  }

  function failure(message, errorCode) {
    const err = new Error(message);
    err.errorCode = errorCode;
    return err;
  }

  /**
   * 服务端条目 → 下拉选项。只挑固定字段：body 等正文相关字段一律不进入结果。
   * @param {object|null|undefined} raw
   * @param {'catalog'|'workspace'} source
   * @param {boolean} readonly
   * @returns {{id:string,title:string,tendency:string,runtime:string,source:string,readonly:boolean}|null}
   */
  function toOption(raw, source, readonly) {
    const id = String(raw?.id || '').trim();
    if (!id) return null; // 没有 id 的条目无法回传选中值，不能出现在下拉里
    return {
      id,
      title: String(raw?.title || '').trim(),
      tendency: String(raw?.tendency || '').trim(),
      runtime: String(raw?.runtime || '').trim(),
      source,
      readonly: Boolean(readonly),
    };
  }

  /**
   * 目录在前（保持服务端顺序、只读），工作空间条目按 id 去重后追加。
   * 工作空间里的系统 skill 副本带服务端 readonly 标记，只有真正的自定义才是可编辑的。
   */
  function mergeOptions(catalogSkills, workspaceSkills) {
    const merged = [];
    const seen = new Set();
    const push = (option) => {
      if (!option || seen.has(option.id)) return;
      seen.add(option.id);
      merged.push(option);
    };
    (Array.isArray(catalogSkills) ? catalogSkills : []).forEach((raw) => {
      push(toOption(raw, 'catalog', true));
    });
    (Array.isArray(workspaceSkills) ? workspaceSkills : []).forEach((raw) => {
      push(toOption(raw, 'workspace', Boolean(raw?.readonly)));
    });
    return merged;
  }

  /** 只有出现在合并列表里的 id 才能当默认值，否则下拉会显示空选中。 */
  function pickPresentId(options, rawId) {
    const id = String(rawId || '').trim();
    if (!id) return '';
    return options.some((option) => option.id === id) ? id : '';
  }

  function titleOf(options, id) {
    const hit = options.find((option) => option.id === id);
    return hit ? hit.title : '';
  }

  function finish(options, defaultSkillId, partialError) {
    return {
      skills: options,
      defaultSkillId,
      defaultTitle: titleOf(options, defaultSkillId),
      partialError: Boolean(partialError),
    };
  }

  function cloneResult(value) {
    return { ...value, skills: value.skills.map((skill) => ({ ...skill })) };
  }

  function cacheKeyOf(loggedIn, tenantId, workspaceId) {
    return `${loggedIn ? '1' : '0'}|${tenantId}|${workspaceId}`;
  }

  function readCache(key) {
    return cache && cache.key === key ? cache.value : null;
  }

  function writeCache(key, value) {
    cache = { key, value };
  }

  /** 测试与工作空间切换用：丢弃当前快照。 */
  function resetCache() {
    cache = null;
  }

  async function loadAnonymous({ baseUrl, trialApi }) {
    if (!trialApi || typeof trialApi.getPromptSkills !== 'function') {
      throw failure('page advisor trial api unavailable', 'PAGE_ADVISOR_TRIAL_API_MISSING');
    }
    const resp = await trialApi.getPromptSkills(baseUrl);
    const skills = mergeOptions(resp?.skills, []);
    return finish(skills, pickPresentId(skills, resp?.default_skill_id), false);
  }

  /**
   * 两份来源并发拉取：保留成功的那份并标 partialError；两份都失败才 reject。
   * 工作空间未解析出来时按该来源失败处理（仍在结果里如实暴露为 partial）。
   */
  async function loadLoggedIn({ tenantId, workspaceId, api }) {
    if (!api || typeof api.getSystemPromptSkills !== 'function' || typeof api.getPromptSkills !== 'function') {
      throw failure('page advisor api unavailable', 'PAGE_ADVISOR_API_MISSING');
    }
    const settled = await Promise.allSettled([
      Promise.resolve().then(() => api.getSystemPromptSkills()),
      Promise.resolve().then(() => {
        if (!tenantId || !workspaceId) {
          throw failure('workspace scope required', 'PAGE_ADVISOR_PROMPT_WORKSPACE_MISSING');
        }
        return api.getPromptSkills(tenantId, workspaceId);
      }),
    ]);

    const catalogOk = settled[0].status === 'fulfilled';
    const workspaceOk = settled[1].status === 'fulfilled';
    if (!catalogOk && !workspaceOk) throw aggregateFailure(settled);

    const catalog = catalogOk ? settled[0].value : null;
    const workspace = workspaceOk ? settled[1].value : null;
    const skills = mergeOptions(catalog?.skills, workspace?.skills);
    const activeId = pickPresentId(skills, workspace?.active_skill_id);
    const defaultSkillId = activeId || pickPresentId(skills, catalog?.default_skill_id);
    return finish(skills, defaultSkillId, !catalogOk || !workspaceOk);
  }

  /** 两份都失败：主错误取目录那份（登录态更常见的是它先挂），并保留两份明细。 */
  function aggregateFailure(settled) {
    const reasons = settled.map((entry) => (entry.status === 'rejected' ? entry.reason : null));
    const primary = reasons[0] || reasons[1];
    const err = new Error(
      String(primary?.message || '').trim() || 'page advisor prompt options unavailable',
    );
    err.errorCode = String(primary?.errorCode || '').trim() || 'PAGE_ADVISOR_PROMPT_OPTIONS_FAILED';
    if (String(primary?.traceId || '').trim()) err.traceId = String(primary.traceId).trim();
    if (primary?.status != null) err.status = primary.status;
    err.errors = [
      { source: 'catalog', error: reasons[0] },
      { source: 'workspace', error: reasons[1] },
    ];
    return err;
  }

  /**
   * @param {{ loggedIn?: boolean, baseUrl?: string, tenantId?: string, workspaceId?: string,
   *   api?: object|null, trialApi?: object|null }} [input]
   * @returns {Promise<{skills: object[], defaultSkillId: string, defaultTitle: string,
   *   partialError: boolean}>}
   */
  async function load(input = {}) {
    const loggedIn = Boolean(input.loggedIn);
    const tenantId = String(input.tenantId || '').trim();
    const workspaceId = String(input.workspaceId || '').trim();
    const key = cacheKeyOf(loggedIn, tenantId, workspaceId);

    const cached = readCache(key);
    if (cached) return cloneResult(cached);

    const result = loggedIn
      ? await loadLoggedIn({ tenantId, workspaceId, api: input.api })
      : await loadAnonymous({ baseUrl: input.baseUrl, trialApi: input.trialApi });

    // 只缓存完整结果：partial 下次仍重试缺失来源，避免把一次故障固化到 SW 生命周期。
    if (!result.partialError) writeCache(key, result);
    return cloneResult(result);
  }

  /** @returns {Promise<string>} 上次选中的提示词 id；没有则空串。 */
  async function loadSelectedId() {
    const store = storageApi();
    if (!store) return '';
    const got = await store.get([SELECTED_KEY]);
    return String(got?.[SELECTED_KEY] || '').trim();
  }

  /** @param {string} id @returns {Promise<string>} 实际写入的值。 */
  async function saveSelectedId(id) {
    const value = String(id || '').trim();
    const store = storageApi();
    if (store) await store.set({ [SELECTED_KEY]: value });
    return value;
  }

  /** 委托旧链存储清理；实现见 lib/page-advisor-legacy-cleanup.js。 */
  async function cleanupLegacyStorage() {
    const Cleanup = typeof PageAdvisorLegacyCleanup !== 'undefined' ? PageAdvisorLegacyCleanup : null;
    if (!Cleanup || typeof Cleanup.cleanupLegacyStorage !== 'function') return;
    await Cleanup.cleanupLegacyStorage();
  }

  return {
    STORAGE_KEY: SELECTED_KEY,
    load,
    loadSelectedId,
    saveSelectedId,
    cleanupLegacyStorage,
    resetCache,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorPromptOptions;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorPromptOptions = PageAdvisorPromptOptions;
}
