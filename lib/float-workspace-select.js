/**
 * 悬浮面板工作空间下拉框在鉴权刷新后的 UI 决策（纯函数，无 Chrome API）
 *
 * 角标定时刷新不得把已加载的工作空间冲回「加载中...」。
 */

/**
 * @param {{
 *   loggedIn: boolean,
 *   mode?: 'full' | 'badgeOnly',
 *   invalidated?: boolean,
 * }} state
 * @returns {'loading' | 'login_required' | 'refresh_page' | 'leave'}
 */
function resolveFloatWorkspaceSelectAction(state) {
  const mode = state?.mode === 'badgeOnly' ? 'badgeOnly' : 'full';
  if (state?.invalidated) return 'refresh_page';
  if (!state?.loggedIn) return 'login_required';
  if (mode === 'badgeOnly') return 'leave';
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
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatWorkspaceSelect;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatWorkspaceSelect = FloatWorkspaceSelect;
}
