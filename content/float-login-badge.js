/**
 * 「快速创建任务」旁的「去登录」：点击后走与弹窗相同的 oauthStart。
 * 同步门闩见 createClickGuard；oauthStart 由 Service Worker 打开授权页。
 */
var loginBadgeGuard = typeof createClickGuard === 'function' ? createClickGuard() : null;

function showLoginBadgeNotice(text) {
  if (typeof showPageToast === 'function') showPageToast(text);
  if (typeof resultDiv !== 'undefined' && resultDiv) {
    resultDiv.textContent = text;
    resultDiv.className = 'taskplugin-result taskplugin-show';
  }
}

function loginBadgeTx(key, fallback) {
  return typeof tx === 'function' ? tx(key) : fallback;
}

async function startLoginBadgeOAuth() {
  if (typeof isLoggedIn !== 'undefined' && isLoggedIn) return;
  if (!badge || badge.disabled) return;
  var cfg = typeof Storage !== 'undefined' && Storage.getApiConfig
    ? await Storage.getApiConfig()
    : null;
  var baseUrl = cfg && cfg.baseUrl ? String(cfg.baseUrl).trim() : '';
  if (!baseUrl) {
    showLoginBadgeNotice(loginBadgeTx('popupServerUrlRequired', '请填写服务器地址'));
    return;
  }
  badge.setAttribute('aria-busy', 'true');
  try {
    var res = await sendMessageWithTimeout({ action: 'oauthStart', baseUrl: baseUrl }, 30000);
    if (res && res.success) {
      showLoginBadgeNotice(loginBadgeTx('floatOauthOpened', '已打开授权页，请在新标签页完成登录'));
    } else {
      showLoginBadgeNotice((res && res.error) || loginBadgeTx('popupLoginFailed', '登录失败'));
    }
  } catch (e) {
    showLoginBadgeNotice((e && e.message) || loginBadgeTx('popupLoginFailed', '登录失败'));
  } finally {
    if (badge) badge.setAttribute('aria-busy', 'false');
  }
}

function onLoginBadgeClick() {
  if (!badge || badge.disabled) return;
  var go = function () { return startLoginBadgeOAuth(); };
  if (loginBadgeGuard) loginBadgeGuard.run(go);
  else go();
}

function bindLoginBadgeOAuth() {
  if (!badge || badge.getAttribute('data-oauth-bound') === '1') return;
  badge.setAttribute('data-oauth-bound', '1');
  badge.addEventListener('click', onLoginBadgeClick);
}

bindLoginBadgeOAuth();
