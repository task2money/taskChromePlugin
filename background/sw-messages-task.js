/** Task / capture / account runtime messages (OPT-20260821-004 split). */
async function handleMessageRest(message, sender) {
  switch (message.action) {
    case 'createTask':
      try {
        await initApiFromMessage(message);
        const taskData = await enrichTaskDataWithOwner(message.taskData);
        const data = await API.createTask(taskData);
        await Storage.addTaskHistory({
          type: 'single',
          title: taskData?.title || '(无标题)',
          workspaceId: taskData?.workspaceId || taskData?.workspace_id,
          projectIds: taskData?.projectIds || taskData?.projects,
          status: 'success',
          resultId: data?.id || data?._id,
          taskData,
          response: data,
        });
        return { success: true, data };
      } catch (e) {
        await Storage.addTaskHistory({
          type: 'single',
          title: message.taskData?.title || '(无标题)',
          workspaceId: message.taskData?.workspaceId,
          projectIds: message.taskData?.projectIds,
          status: 'failed',
          error: e.message,
          taskData: message.taskData,
        });
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'createTasksBatch':
      try {
        await initApiFromMessage(message);
        const tasksData = [];
        for (const task of message.tasksData || []) {
          tasksData.push(await enrichTaskDataWithOwner(task));
        }
        const data = await API.createTasksBatch(tasksData);
        const tasksArr = Array.isArray(message.tasksData) ? message.tasksData : [];
        const hasErrors = data.errors && data.errors.length > 0;
        await Storage.addTaskHistory({
          type: 'batch',
          title: `批量创建 ${data.total} 个任务`,
          workspaceId: tasksArr[0]?.workspaceId || tasksArr[0]?.workspace_id,
          projectIds: tasksArr[0]?.projectIds || tasksArr[0]?.projects,
          count: data.total,
          status: hasErrors ? 'partial' : 'success',
          resultId: `${data.succeeded}/${data.total}`,
          response: data,
        });
        if (hasErrors) {
          return { success: true, data, warning: data.errors.map(e => `${e.task}: ${e.error}`).join('; ') };
        }
        return { success: true, data };
      } catch (e) {
        const tasksArr = Array.isArray(message.tasksData) ? message.tasksData : [];
        await Storage.addTaskHistory({
          type: 'batch',
          title: `批量创建 ${tasksArr.length} 个任务`,
          workspaceId: tasksArr[0]?.workspaceId || tasksArr[0]?.workspace_id,
          projectIds: tasksArr[0]?.projectIds || tasksArr[0]?.projects,
          count: tasksArr.length,
          status: 'failed',
          error: e.message,
          tasksData: tasksArr,
        });
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    // ---- 捕获、存储、配置 ----

    case 'setCaptureEnabled':
      if (message.enabled) {
        await Storage.saveCaptureConfig(true, message.statusCodes || ['2xx', '3xx', '4xx', '5xx', 'canceled']);
      } else {
        await Storage.saveCaptureConfig(false, message.statusCodes || ['2xx', '3xx', '4xx', '5xx', 'canceled']);
      }
      // 缓存主动失效（storage.onChanged 兜底已覆盖外部写入路径）
      invalidateCaptureConfigCache();
      return { success: true };

    case 'getCapturedErrors':
      return { success: true, data: await Storage.getCapturedErrors() };

    case 'clearCapturedErrors':
      // 丢弃缓冲中的 pending 条目，避免下一轮 flush 把「已清空」的数据回写
      capturedBuffer.discard();
      await Storage.clearCapturedErrors();
      return { success: true };

    case 'getApiConfig':
      return { success: true, data: await Storage.getApiConfig() };

    case 'getCaptureConfig':
      return { success: true, data: await Storage.getCaptureConfig() };

    case 'getTrackingConfig':
      return { success: true, data: await Storage.getTrackingConfig() };

    case 'setTrackingConfig':
      await Storage.saveTrackingConfig(message.enabled);
      return { success: true };

    case 'setElementPickerShortcut':
      return await applyElementPickerShortcut(message.shortcut);

    case 'getElementPickerShortcutStatus':
      return await getElementPickerShortcutStatus();

    case 'getTaskHistory':
      return { success: true, data: await Storage.getTaskHistory() };

    case 'addTaskHistory':
      await Storage.addTaskHistory(message.entry);
      return { success: true };

    case 'clearTaskHistory':
      await Storage.clearTaskHistory();
      return { success: true };

    case 'getFailedTasks':
      return { success: true, data: await Storage.getFailedTasks() };

    case 'getEndpointMapping':
      return { success: true, data: await Storage.getEndpointMapping() };

    case 'saveEndpointMapping':
      await Storage.saveEndpointMapping(message.mapping);
      API.setEndpointMapping(message.mapping);
      if (message.mapping.owner) {
        API.setOwner(message.mapping.owner);
      }
      return { success: true };

    case 'getFloatBallConfig':
      try {
        return { success: true, data: await Storage.getFloatBallConfig() };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'saveFloatBallConfig':
      try {
        await Storage.saveFloatBallConfig(message.enabled);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'getFloatBallPosition':
      try {
        return { success: true, data: await Storage.getFloatBallPosition() };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'saveFloatBallPosition':
      try {
        await Storage.saveFloatBallPosition(message.x, message.y);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message, traceId: e.traceId || '' };
      }

    case 'startElementPick':
      {
        const tabId = message.tabId || sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tabId，无法启动元素选择' };
        try {
          const resp = await chrome.tabs.sendMessage(tabId, {
            action: 'startElementPick',
            source: message.source || 'float',
          }, { frameId: 0 });
          await broadcastPickToChildFrames(tabId, 'startElementPick', message.source || 'float');
          console.log('[taskChromePlugin] startElementPick forwarded to tab', tabId);
          return resp?.success ? { success: true } : { success: false, error: resp?.error || 'content script 未响应' };
        } catch (e) {
          return { success: false, error: e.message || '无法联系页面 content script（请刷新页面）' };
        }
      }

    case 'broadcastStartElementPick':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tabId' };
        await broadcastPickToChildFrames(tabId, 'startElementPick', message.source || 'float');
        return { success: true };
      }

    case 'cancelElementPickBroadcast':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: true };
        await broadcastPickToChildFrames(tabId, 'cancelElementPick');
        return { success: true };
      }

    // OPT-20260806-016: 子 frame 内页内兜底按键转发（跨域 iframe 按键不冒泡到
    // 顶层，content.js 的 keydown 兜底在子 frame 聚焦时不触发）。
    // 复用浏览器命令路径（frame0 优先、整 tab 广播回退），与去抖保护天然一致。
    case 'toggleElementPickShortcut':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tabId' };
        await toggleElementPickInTab(tabId);
        return { success: true };
      }

    case 'elementPickedInFrame':
      {
        const tabId = sender?.tab?.id;
        if (!tabId) return { success: false, error: '缺少 tab' };
        try {
          const leafFrameId = sender.frameId != null ? sender.frameId : 0;
          let frames = [];
          try {
            frames = await chrome.webNavigation.getAllFrames({ tabId });
          } catch (e) {
            console.warn('[taskChromePlugin] getAllFrames for pick path failed:', e.message || e);
          }
          const framePath = (typeof ElementPicker !== 'undefined' && ElementPicker.buildFramePathFromRoot)
            ? ElementPicker.buildFramePathFromRoot(frames || [], leafFrameId)
            : [];
          const ancestorIframeRects = await collectAncestorIframeRects(tabId, framePath);
          await chrome.tabs.sendMessage(tabId, {
            action: 'elementPickedInFrame',
            snapshot: message.snapshot,
            rectInFrame: message.rectInFrame,
            frameUrl: message.frameUrl,
            framePath,
            ancestorIframeRects,
            leafFrameId,
          }, { frameId: 0 });
          console.log(
            '[taskChromePlugin] elementPickedInFrame forwarded to top frame, nest=',
            framePath.length,
          );
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message || '转发到顶层失败' };
        }
      }

    case 'captureElementScreenshot':
      {
        try {
          const tabId = sender?.tab?.id;
          if (tabId == null) return { success: false, error: '截图需要来自页面的请求' };
          const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
            format: 'jpeg',
            quality: 72,
          });
          const cropped = await cropCaptureToElement(
            dataUrl,
            message.rect,
            message.devicePixelRatio || 1,
            message.maxWidth || 400,
          );
          return { success: true, dataUrl: cropped };
        } catch (e) {
          console.error('[taskChromePlugin] captureElementScreenshot failed:', e);
          return { success: false, error: e.message || '截图失败', traceId: e.traceId || '' };
        }
      }

    case 'uploadPluginScreenshot':
      {
        try {
          if (!message.dataUrl) return { success: false, error: '缺少截图 dataUrl' };
          const cfg = await Storage.getApiConfig();
          const mapping = await Storage.getEndpointMapping();
          const cred = await Storage.getCredentials();
          if (!cfg.token) return { success: false, error: '请先登录后再上传截图' };
          API.init(cfg.baseUrl, cfg.token, mapping, cred.userId || '');
          const data = await API.uploadPluginScreenshot(message.dataUrl);
          const url = data?.url || data?.absolute_url;
          if (!url) throw new Error('上传响应缺少 url');
          console.log('[taskChromePlugin] uploadPluginScreenshot ok');
          return { success: true, url, data };
        } catch (e) {
          console.error('[taskChromePlugin] uploadPluginScreenshot failed:', e);
          return { success: false, error: e.message || '上传失败', traceId: e.traceId || '' };
        }
      }

    // ---- 多账号管理 (Multi-Account Bridge) ----

    case 'getSavedAccounts':
      {
        const list = await MultiAccount.listSavedAccounts();
        return { success: true, data: list };
      }

    case 'upsertSavedAccount':
      {
        const result = await MultiAccount.upsertSavedAccount(message);
        return { success: true, data: result };
      }

    case 'removeSavedAccount':
      {
        const result = await MultiAccount.removeSavedAccount(message.userId);
        return { success: true, data: result };
      }

    // OPT-20260806-056: 网页端主动清理过期/指定槽位（与 accountExpired 消费配套）
    case 'pruneSavedAccounts':
      {
        const userIds = Array.isArray(message.userIds) ? message.userIds : [];
        const result = await MultiAccount.pruneSavedAccounts(userIds);
        return { success: true, data: result };
      }

    case 'getActiveToken':
      {
        const token = await MultiAccount.getActiveToken();
        return { success: true, data: token };
      }

    case 'getActiveAccount':
      {
        const account = await MultiAccount.getActiveAccount();
        return { success: true, data: account };
      }

    case 'getCurrentUserId':
      {
        const userId = await MultiAccount.getActiveCurrentUserId();
        return { success: true, data: userId };
      }

    case 'switchAccount':
      {
        try {
          const account = await MultiAccount.setActiveUserId(message.userId);
          // 同步 token 到现有 API 模块，使后续 API 调用使用新账号
          API.init(
            undefined,        // 保持 baseUrl 不变
            account.token,
            undefined,        // 保持 endpointMapping
            account.userId,
          );
          await Storage.saveApiConfig('', account.token, 0, '');
          await Storage.saveCredentials(account.username, account.userId, '');
          return { success: true, data: account };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

    case 'setActiveAccount':
      {
        try {
          const upsertResult = await MultiAccount.upsertSavedAccount(message);
          const account = await MultiAccount.setActiveUserId(upsertResult.upserted.userId);
          // 同步到现有 API/Storage 层
          API.init(undefined, account.token, undefined, account.userId);
          // 切到 savedAccounts 旧账号：必须清空 OAuth refreshToken，
          // 否则过期后静默刷新会把 token 换回 OAuth 账号（OPT-20260824-052）
          await Storage.saveApiConfig('', account.token, 0, '');
          await Storage.saveCredentials(account.username, account.userId, '');
          return { success: true, data: upsertResult };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

    case 'clearSavedAccounts':
      {
        await MultiAccount.clearSavedAccounts();
        await Storage.clearAuth();
        API.init(undefined, '', undefined, '');
        return { success: true };
      }

    case 'lookupRequestBody':
      {
        const body = requestBodyCache.lookup({
          method: message.method,
          url: message.url,
          tabId: message.tabId,
          timestamp: message.timestamp,
          requestId: message.requestId,
        });
        return { success: true, body };
      }

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}
