/**
 * 去抖后 auth 刷新「隐藏页跳过」决策（OPT-20260808-023 F5）
 *
 * 背景：auth 广播（storage.onChanged / authStateChanged）会触发全部标签页的
 * scheduleAuthRefresh 去抖回调，可见标签页各做一轮
 * checkLoginStatus(full) + loadWorkspaces()（网络请求 + DOM 重建）——多标签页
 * 叠加即跨页放大风暴。隐藏/后台标签页无需立即同步（用户看不到），跳过全量
 * 刷新，交给 60s 角标低频定时器兜底；恢复可见后下一次变更事件会重新调度。
 *
 * 纯函数，document 可注入（单测驱动；默认取全局 document，缺失视为可见——
 * 保守策略：不确定时刷新，不静默丢登录态）。
 */

function shouldSkipDebouncedAuthRefresh(doc) {
  const d = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;
  return !!(d && d.hidden);
}

const AuthRefreshDebounce = { shouldSkipDebouncedAuthRefresh };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthRefreshDebounce;
}
if (typeof globalThis !== 'undefined') {
  globalThis.AuthRefreshDebounce = AuthRefreshDebounce;
}
