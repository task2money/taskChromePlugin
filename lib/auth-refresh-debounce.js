/**
 * 去抖后 auth 刷新「隐藏页跳过」决策（OPT-20260808-023 F5）
 *
 * 背景：storage.onChanged 会触发已打开标签页的
 * scheduleAuthRefresh 去抖回调。隐藏/后台标签页无需立即同步。
 *
 * 纯函数，document 可注入（单测驱动；默认取全局 document，缺失视为可见——
 * 保守策略：不确定时刷新，不静默丢登录态）。
 */

function shouldSkipDebouncedAuthRefresh(doc) {
  const d = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;
  return !!(d && d.hidden);
}

/**
 * 角标定时 tick / 可见性补拍之后要不要拉工作空间。
 *
 * 隐藏页跳过 storage 全量刷新后必须 full 补跑，否则会出现
 * 「右上角已登录 + 工作空间下拉仍请先登录」。
 *
 * @param {{
 *   pendingHiddenRefresh?: boolean,
 *   loggedIn?: boolean,
 *   selectNeedsLoad?: boolean,
 * }} state
 * @returns {'full' | 'loadWorkspaces' | 'none'}
 */
function resolveAuthBadgeTickFollowUp(state) {
  if (state?.pendingHiddenRefresh) return 'full';
  if (state?.loggedIn && state?.selectNeedsLoad) return 'loadWorkspaces';
  return 'none';
}

const AuthRefreshDebounce = { shouldSkipDebouncedAuthRefresh, resolveAuthBadgeTickFollowUp };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthRefreshDebounce;
}
if (typeof globalThis !== 'undefined') {
  globalThis.AuthRefreshDebounce = AuthRefreshDebounce;
  globalThis.resolveAuthBadgeTickFollowUp = resolveAuthBadgeTickFollowUp;
}
