async function handleMessage(message, sender) {
  switch (message.action) {
    case 'ping':
      return { pong: true };

    case 'resetBadge':
      tab5xxCounts.set(activeTabId, 0);
      updateBadgeForActiveTab();
      return { success: true };

    case 'checkTokenStatus':
      {
        // OPT-20260824-052：过期但持 refresh token → 先静默续期再返回最新剩余时间
        const cfg0 = await Storage.getApiConfig();
        if (cfg0.token && cfg0.refreshToken && await Storage.isTokenExpired()) {
          try {
            await silentRefreshToken();
          } catch (e) {
            console.warn('[taskChromePlugin] checkTokenStatus 静默刷新失败:', e?.message || e);
          }
        }
        return {
          success: true,
          data: {
            expired: await Storage.isTokenExpired(),
            remainingSeconds: await Storage.getTokenRemainingSeconds(),
          },
        };
      }

    case 'oauthRefresh':
      // 显式触发静默续期（无 refresh token / 未登录 → 不刷新，返回现状）
      {
        try {
          const refreshed = await silentRefreshToken();
          if (!refreshed) {
            const cfgN = await Storage.getApiConfig();
            return { success: true, data: { refreshed: false, loggedIn: !!cfgN.token } };
          }
          return {
            success: true,
            data: {
              refreshed: true,
              token: refreshed.token,
              remainingSeconds: await Storage.getTokenRemainingSeconds(),
            },
          };
        } catch (e) {
          return { success: false, error: e?.message || 'OAuth 刷新失败' };
        }
      }

    case 'getAuthStatus':
      {
        await Storage.migrateStaleTokenExpiryOnce();
        let cfg = await Storage.getApiConfig();
        let cred = await Storage.getCredentials();
        let expired = cfg.token ? await Storage.isTokenExpired() : false;

        // OPT-20260824-052：持 refresh token 且已过期 → 静默续期后返回最新状态；
        // 刷新失败（refresh token 失效/网络/服务端拒绝）→ 保留现有状态，UI 走「重新登录」兜底
        if (expired && cfg.refreshToken) {
          try {
            await silentRefreshToken();
            cfg = await Storage.getApiConfig();
            expired = cfg.token ? await Storage.isTokenExpired() : true;
          } catch (e) {
            console.warn('[taskChromePlugin] access token 静默刷新失败:', e?.message || e);
          }
        }

        const remainingSeconds = await Storage.getTokenRemainingSeconds();
        // 注意：refreshToken 仅存 SW 侧，绝不随消息泄漏给页面（页面只用 Bearer access token）
        return {
          success: true,
          data: {
            baseUrl: cfg.baseUrl,
            token: cfg.token,
            tokenExpiresAt: cfg.tokenExpiresAt,
            tokenIssuedAt: cfg.tokenIssuedAt,
            username: cred.username || '',
            userId: cred.userId || '',
            memberId: cred.memberId || '',
            expired,
            loggedIn: !!(cfg.token && !expired),
            remainingSeconds,
            expiryHint: Storage.formatTokenExpiryHint(remainingSeconds),
          },
        };
      }

    // ---- 请求追踪 ----

    case 'addRecentRequest':
      devToolsRequests.push(message.request);
      if (devToolsRequests.length > MAX_DEVTOOLS_REQUESTS) {
        devToolsRequests.splice(0, devToolsRequests.length - MAX_DEVTOOLS_REQUESTS);
      }
      return { success: true };

    case 'updateRecentRequest':
      {
        const req = message.request;
        if (!req?.id) return { success: false, error: 'missing request id' };
        const idx = devToolsRequests.findIndex((r) => r.id === req.id);
        if (idx >= 0) {
          devToolsRequests[idx] = req;
        } else {
          devToolsRequests.push(req);
          if (devToolsRequests.length > MAX_DEVTOOLS_REQUESTS) {
            devToolsRequests.splice(0, devToolsRequests.length - MAX_DEVTOOLS_REQUESTS);
          }
        }
        return { success: true };
      }

    case 'getRecentRequests':
      {
        let list = [...devToolsRequests];
        if (message.filter?.errorsOnly) {
          // 与插件角标示数一致：仅 5xx
          list = CaptureStatus.filterBadgeCountableRequests(list);
        }
        list.sort((a, b) => b.timestamp - a.timestamp);
        return { success: true, data: list.slice(0, message.limit || 50) };
      }

    case 'clearRecentRequests':
      // 面板「🗑️ 清空列表」：仅清空 DevTools 转发的内存缓存。
      // seenHarKeys 由 DevTools 页保留，避免 HAR 补录把已清条目重新加回。
      devToolsRequests = [];
      return { success: true };

    case 'updateApiConfig':
      API.init(message.baseUrl, message.token);
      await Storage.saveApiConfig(message.baseUrl, message.token);
      return { success: true };

    // ---- 登录（OAuth2+PKCE，OPT-20260808-024）----
    // 旧密码/访问令牌/Cookie 桥接登录已移除；登录入口为 oauthStart → oauthCallback。
    // PKCE 会话（verifier/state）仅存扩展 storage 5 分钟，回调页凭 state 取回校验。

    case 'oauthStart':
      {
        const baseUrl = String(message.baseUrl || '').trim();
        if (!baseUrl) return { success: false, error: '缺少服务器地址' };
        try {
          const verifier = OAuthPKCE.generateCodeVerifier();
          const codeChallenge = await OAuthPKCE.generateCodeChallenge(verifier);
          const state = OAuthPKCE.generateState();
          const session = {
            verifier,
            state,
            baseUrl,
            createdAt: Date.now(),
          };
          await chrome.storage.local.set({ oauthPkceSession: session });
          const authorizeUrl = OAuthPKCE.buildAuthorizeUrl({
            baseUrl,
            extensionId: chrome.runtime.id,
            state,
            codeChallenge,
          });
          await chrome.tabs.create({ url: authorizeUrl });
          return { success: true };
        } catch (e) {
          console.warn('[taskChromePlugin] oauthStart 失败:', e?.message || e);
          return { success: false, error: e?.message || '无法打开授权页' };
        }
      }

    case 'oauthCallback':
      {
        const { code, state } = message;
        try {
          const stored = await chrome.storage.local.get('oauthPkceSession');
          const session = stored && stored.oauthPkceSession;
          // state 校验（防 CSRF）与 TTL（5 分钟）——与 lib/oauth-callback.js 同规则
          if (!session || session.state !== state) {
            return { success: false, error: 'state 校验失败，请重新登录' };
          }
          if (session.createdAt && Date.now() - session.createdAt > 5 * 60 * 1000) {
            return { success: false, error: '登录会话已过期，请重新登录' };
          }

          const redirectUri = `chrome-extension://${chrome.runtime.id}${OAuthPKCE.REDIRECT_PATH}`;
          const tokenRes = await OAuthPKCE.exchangeCodeForToken({
            baseUrl: session.baseUrl,
            code,
            redirectUri,
            codeVerifier: session.verifier,
          });
          const accessToken = tokenRes.access_token;
          if (!accessToken) return { success: false, error: 'OAuth token 交换未返回 access_token' };

          const userInfo = await OAuthPKCE.fetchUserInfo(session.baseUrl, accessToken);
          const username = userInfo.preferred_username || userInfo.name || userInfo.email || userInfo.sub || '';
          const userId = userInfo.sub || '';

          // 单账号语义（OPT-20260806-036）：只写 apiConfig + credentials，不占 savedAccounts 槽位
          // refreshToken（OPT-20260824-052）：offline_access 签发，access token 过期后静默续期
          const result = await completeLoginAndRespond(
            session.baseUrl,
            accessToken,
            tokenRes.expires_in || 3600,
            tokenRes.refresh_token || '',
            username,
            userId,
            '',
            { user: userInfo },
          );

          await chrome.storage.local.remove('oauthPkceSession');

          // 关闭回调页（登录成功后自动收尾；失败页保留展示错误）
          const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
          if (typeof tabId === 'number') {
            setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 1500);
          }
          return result;
        } catch (e) {
          console.warn('[taskChromePlugin] oauthCallback 失败:', e?.message || e);
          return { success: false, error: e?.message || 'OAuth 登录处理失败', traceId: e?.traceId || '' };
        }
      }

    case 'logout':
      try {
        await Storage.clearAuth();
        API.clearSession();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    // ---- 工作空间/项目/成员 ----

    case 'getWorkspaces':
      try {
        await initApiFromMessage(message);
        const data = await API.getWorkspaces(message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getProjects':
      try {
        await initApiFromMessage(message);
        const data = await API.getProjects(message.workspaceId, message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getMembers':
      try {
        await initApiFromMessage(message);
        // OPT-20260820-040: workspaceId 存在时走 workspace-collaborators（普通成员可见）
        const data = await API.getMembers(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'fetchProgressColumns':
      try {
        await initApiFromMessage(message);
        const data = await API.fetchProgressColumns(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getBranches':
      try {
        await initApiFromMessage(message);
        const data = await API.getBranches(message.companyId, message.projectId, message.repoUrl);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getDeliverableTypes':
      try {
        await initApiFromMessage(message);
        const data = await API.getDeliverableTypes(message.companyId, message.workspaceId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getInstalledImages':
      try {
        await initApiFromMessage(message);
        const data = await API.getInstalledImages(message.companyId);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getPersonalFeatureParamsConfigs':
      try {
        await initApiFromMessage(message);
        const data = await API.getPersonalFeatureParamsConfigs();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getQueueSchedule':
      try {
        await initApiFromMessage(message);
        const companyId = String(message.companyId || '').trim();
        const workspaceId = String(message.workspaceId || '').trim();
        if (!companyId || !workspaceId) throw new Error('缺少 companyId 或 workspaceId');
        const path = `/api/tenant/${encodeURIComponent(companyId)}/workspace/${encodeURIComponent(workspaceId)}/queue-schedule/`;
        const data = await API.request('GET', path);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'listGitIdentities':
      try {
        await initApiFromMessage(message);
        const uid = API.getUserId();
        if (!uid) throw new Error('缺少 userId');
        const path = CreateTaskGitIdentity.gitIdentitiesRequestPath(uid, message.companyId);
        const data = await API.request('GET', path);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'resolveAidevMeta':
      try {
        await initApiFromMessage(message);
        const data = await API.resolveAidevMeta({
          serviceId: message.serviceId,
          tag: message.tag,
        });
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    default:
      return handleMessageRest(message, sender);
  }
}
