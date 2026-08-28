/** Element pick broadcast / screenshot / shortcut apply (OPT-20260821-004 split). */
/**
 * 向除顶层外的所有 frame 广播选元素指令。
 * OPT-20260808-023 F3：逐 frame 串行 await 会因任一子 frame 卡死拖住整个 SW 消息
 * 处理；改为并行 + withTimeout（≤800ms settle），卡死 frame 不再阻塞其余广播。
 */
async function broadcastPickToChildFrames(tabId, action, source) {
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    console.warn('[taskChromePlugin] getAllFrames failed:', e.message || e);
    return;
  }
  const targets = (frames || []).filter((f) => f && f.frameId !== 0);
  await Promise.allSettled(
    targets.map((f) => {
      const send = chrome.tabs.sendMessage(tabId, {
        action,
        source: source || 'float',
      }, { frameId: f.frameId }).catch(() => {});
      if (typeof withTimeout === 'function') {
        return withTimeout(send, AUTH_BROADCAST_TAB_TIMEOUT_MS, 'pick broadcast').catch(() => {});
      }
      return send;
    }),
  );
}

/**
 * 沿 framePath（近顶→leaf）向各父 frame 查询子 iframe 在父视口中的矩形
 */
async function collectAncestorIframeRects(tabId, framePath) {
  const path = Array.isArray(framePath) ? framePath : [];
  const rects = [];
  for (let i = 0; i < path.length; i++) {
    const child = path[i];
    const parentFrameId = i === 0 ? 0 : path[i - 1].frameId;
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        action: 'locateChildFrameRect',
        childFrameUrl: child.url,
      }, { frameId: parentFrameId });
      if (resp?.success && resp.rect) {
        rects.push({
          left: resp.rect.left || 0,
          top: resp.rect.top || 0,
          width: resp.rect.width || 0,
          height: resp.rect.height || 0,
        });
      } else {
        rects.push({ left: 0, top: 0, width: 0, height: 0 });
      }
    } catch (_) {
      rects.push({ left: 0, top: 0, width: 0, height: 0 });
    }
  }
  return rects;
}

/**
 * 将整页截图裁剪为元素区域并缩放
 * @param {string} dataUrl
 * @param {{left:number,top:number,width:number,height:number}} rect CSS 像素
 * @param {number} dpr
 * @param {number} maxWidth
 */
async function cropCaptureToElement(dataUrl, rect, dpr, maxWidth) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    throw new Error('无效的元素矩形');
  }
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.left * dpr));
  const sy = Math.max(0, Math.round(rect.top * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));
  const clampedW = Math.min(sw, bitmap.width - sx);
  const clampedH = Math.min(sh, bitmap.height - sy);
  if (clampedW <= 0 || clampedH <= 0) {
    bitmap.close?.();
    throw new Error('元素矩形超出截图范围');
  }
  const scale = clampedW > maxWidth ? maxWidth / clampedW : 1;
  const outW = Math.max(1, Math.round(clampedW * scale));
  const outH = Math.max(1, Math.round(clampedH * scale));
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 不可用');
  ctx.drawImage(bitmap, sx, sy, clampedW, clampedH, 0, 0, outW, outH);
  bitmap.close?.();
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
  const buffer = await outBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// ---- 键盘快捷键命令 ----

// toggleElementPickInTab 向 tab 顶层 frame 发送切换消息，失败时回退整 tab 广播。
// 供两条路径复用：chrome.commands.onCommand（浏览器级命令）与子 frame 内
// 页内兜底转发（pick-frame.js 检测到按键后经 runtime message 到达，OPT-20260806-016）。
async function toggleElementPickInTab(tabId) {
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tabId, { action: 'toggleElementPick' }, { frameId: 0 });
  } catch (frame0Err) {
    // 顶层 frame 尚未注入 content script（受限页/刷新竞态）时，
    // 回退为整 tab 广播，保证快捷键在内容脚本注入后立即可用
    console.warn(
      '[taskChromePlugin] toggleElementPick frame0 失败，回退整 tab 广播:',
      frame0Err?.message || frame0Err,
    );
    resp = await chrome.tabs.sendMessage(tabId, { action: 'toggleElementPick' });
  }
  console.log(
    '[taskChromePlugin] toggleElementPick via shortcut:',
    resp?.success ? 'ok' : 'content script 未响应',
  );
}

// ---- 元素拾取快捷键动态改绑（chrome.commands.update，Chrome 110+）----
// 平台探测复用 Storage.isMacPlatform（chrome.commands.update 的修饰键规则按平台区分）

/**
 * 应用元素拾取快捷键（Popup「修改/恢复默认」统一入口）：
 * 1) 规范校验；2) chrome.commands.update 改绑浏览器级键位（冲突等错误原样返回给 Popup）；
 *    旧浏览器（< Chrome 110）降级为仅持久化 + 页内兜底生效；
 * 3) 持久化规范串。各页经 chrome.storage.onChanged 更新兜底监听，不向全部标签页 sendMessage。
 *    commands.update 的绑定由 Chrome 持久化，故无需在 SW 启动时重复改绑。
 */
async function applyElementPickerShortcut(shortcut) {
  const normalized = Storage.normalizeShortcut(shortcut);
  if (!normalized) {
    return { success: false, error: `非法快捷键组合: ${String(shortcut)}` };
  }
  const binding = Storage.shortcutToPlatformBinding(normalized, Storage.isMacPlatform());
  if (typeof chrome.commands?.update === 'function') {
    try {
      await chrome.commands.update({ name: 'toggle-element-picker', shortcut: binding });
    } catch (e) {
      // 常见原因：与其他扩展/浏览器命令冲突（"already in use by another extension"）
      const msg = e?.message || '快捷键绑定失败';
      console.warn('[taskChromePlugin] commands.update 失败:', msg);
      return { success: false, error: msg, shortcut: normalized };
    }
  } else {
    console.warn('[taskChromePlugin] chrome.commands.update 不可用（需 Chrome 110+），仅持久化 + 页内兜底生效');
  }
  await Storage.saveElementPickerShortcut(normalized);
  return { success: true, data: { shortcut: normalized } };
}

/**
 * OPT-20260806-048: 读取「配置的快捷键 vs 浏览器实际绑定」差异。
 * 用户可在 chrome://extensions/shortcuts 手动改绑（该绑定优先于配置、且插件
 * 内不可感知 — SW 设计上不做启动重绑，避免覆盖手动设置）；Popup 据此展示提示
 * 「浏览器实际绑定为 X，与配置 Y 不同，点此恢复」。
 * 旧浏览器（<Chrome 110，无 commands.update）无 commands API 时返回 null 绑定。
 */
async function getElementPickerShortcutStatus() {
  const configured = await Storage.getElementPickerShortcut();
  let actual = null;
  if (typeof chrome.commands?.getAll === 'function') {
    try {
      const commands = await chrome.commands.getAll();
      const found = (commands || []).find((c) => c.name === 'toggle-element-picker');
      actual = found?.shortcut || '';
    } catch (e) {
      console.warn('[taskChromePlugin] commands.getAll 失败:', e.message || e);
      actual = null;
    }
  }
  const binding = Storage.shortcutToPlatformBinding(configured, Storage.isMacPlatform());
  const differs = actual != null && actual !== binding;
  return {
    success: true,
    data: {
      configured,
      configuredBinding: binding,
      actual: actual ?? null,
      differs,
    },
  };
}
