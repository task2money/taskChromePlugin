/**
 * OAuth 回调页面脚本
 * 接收 taskAuth OIDC authorize 的重定向，解析 code + state，
 * 发送给 Service Worker 完成 token 交换
 */
(async () => {
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  const spinnerEl = document.getElementById('spinner');

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  if (error) {
    showResult(false, `授权失败: ${error}`, errorDescription || '');
    return;
  }

  if (!code || !state) {
    showResult(false, '授权回调参数不完整', '缺少 code 或 state 参数，请重新登录。');
    return;
  }

  try {
    // 发送 code + state 给 Service Worker 进行 token 交换
    const res = await chrome.runtime.sendMessage({
      action: 'oauthCallback',
      code,
      state,
    });

    if (res?.success) {
      showResult(true, '✅ 登录成功！', '窗口将在 2 秒后关闭。');
      // 自动关闭窗口
      setTimeout(() => {
        try { window.close(); } catch (_) { /* ignore */ }
      }, 2000);
    } else {
      showResult(false, '登录失败', res?.error || 'token 交换失败，请重试。');
    }
  } catch (err) {
    console.error('[OAuth Callback] 消息发送失败:', err);
    showResult(false, '通信失败', '无法连接到扩展后台，请确认扩展已加载后重试。');
  }

  function showResult(success, msg, detail) {
    if (spinnerEl) spinnerEl.style.display = 'none';
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.className = success ? 'success' : 'error';
    }
    if (detailEl && detail) detailEl.textContent = detail;
  }
})();
