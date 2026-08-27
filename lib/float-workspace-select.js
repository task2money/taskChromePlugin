/**
 * 悬浮面板工作空间下拉框在鉴权刷新后的 UI 决策（纯函数，无 Chrome API）
 *
 * 角标定时刷新不得把已加载的工作空间冲回「加载中...」。
 */

/**
 * 下拉第一项是否仍是「未登录/过期/加载失败」占位（非真实工作空间列表）。
 * @param {string} text
 * @returns {boolean}
 */
function isUnauthedWorkspacePlaceholder(text) {
  const t = String(text || '');
  if (!t) return false;
  return /请先登录|会话过期|请刷新页面|请在扩展中重新登录|加载失败/.test(t);
}

/**
 * 已登录时是否还需要拉工作空间列表。
 * workspacesCount>0 视为内存已有列表（即使 DOM 暂未对齐也不再盲打）。
 * @param {{ options?: ArrayLike<{ textContent?: string, text?: string }> }|null} selectEl
 * @param {{ workspacesCount?: number }} [opts]
 * @returns {boolean}
 */
function selectNeedsWorkspaceLoad(selectEl, opts) {
  const workspacesCount = opts?.workspacesCount || 0;
  if (workspacesCount > 0) return false;
  if (!selectEl || !selectEl.options || selectEl.options.length === 0) return true;
  const first = selectEl.options[0];
  const label = first?.textContent || first?.text || '';
  return isUnauthedWorkspacePlaceholder(label);
}

/**
 * @param {{
 *   loggedIn: boolean,
 *   mode?: 'full' | 'badgeOnly',
 *   invalidated?: boolean,
 *   selectNeedsWorkspaceLoad?: boolean,
 * }} state
 * @returns {'loading' | 'login_required' | 'refresh_page' | 'leave'}
 */
function resolveFloatWorkspaceSelectAction(state) {
  const mode = state?.mode === 'badgeOnly' ? 'badgeOnly' : 'full';
  if (state?.invalidated) return 'refresh_page';
  if (!state?.loggedIn) return 'login_required';
  if (mode === 'badgeOnly') {
    // 角标已登录但下拉仍停在「请先登录」时必须进入 loading，交给调用方 loadWorkspaces。
    if (state.selectNeedsWorkspaceLoad) return 'loading';
    return 'leave';
  }
  return 'loading';
}

/**
 * @param {'loading' | 'login_required' | 'refresh_page' | 'leave'} action
 * @returns {string|null} option 文案；null 表示不改动现有 options
 */
function floatWorkspaceSelectPlaceholder(action) {
  switch (action) {
    case 'loading':
      return '加载中...';
    case 'login_required':
      return '-- 请先登录 --';
    case 'refresh_page':
      return '-- 请刷新页面后重试 --';
    case 'leave':
    default:
      return null;
  }
}

const FloatWorkspaceSelect = {
  resolveFloatWorkspaceSelectAction,
  floatWorkspaceSelectPlaceholder,
  isUnauthedWorkspacePlaceholder,
  selectNeedsWorkspaceLoad,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatWorkspaceSelect;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatWorkspaceSelect = FloatWorkspaceSelect;
}
