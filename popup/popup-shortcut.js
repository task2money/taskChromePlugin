/** Popup 元素拾取快捷键 + OAuth 登录/登出（OPT-20260821-004 split）. */
  // ---- 元素拾取快捷键自定义（默认 mac ⌘+Shift+X / 其他 Ctrl+Shift+X，可改任意组合）----

  /** 事件键名 → Chrome 命令键名（ArrowUp→Up、,→Comma、.→Period、空格→Space） */
  function eventKeyToShortcutName(e) {
    const k = e.key || '';
    if (k === ' ') return 'Space';
    if (k.startsWith('Arrow')) return k.slice(5);
    if (k === ',') return 'Comma';
    if (k === '.') return 'Period';
    return k;
  }

  /** 渲染当前快捷键（列表/hint 键位锚点跟随；自定义行独立 id，改键后同步刷新） */
  function renderPickShortcutDisplay(shortcut) {
    const label = shortcut || Storage.detectDefaultShortcut();
    for (const id of ['pickShortcutKey', 'pickShortcutCustomKey', 'pickShortcutHintKey']) {
      const el = document.getElementById(id);
      if (el) el.textContent = label;
    }
  }

  function showShortcutResult(msg, type) {
    const el = $('#pickShortcutResult');
    if (!el) return;
    el.textContent = msg;
    el.className = `shortcut-choice-note ${type || ''}`;
    setTimeout(() => {
      if (el) { el.textContent = ''; el.className = 'shortcut-choice-note'; }
    }, 6000);
  }

  var shortcutCapturing = false;
  var shortcutCaptureHandler = null;

  function setShortcutCapturing(active) {
    shortcutCapturing = active;
    const hint = $('#pickShortcutCaptureHint');
    const editBtn = $('#btnPickShortcutEdit');
    if (hint) hint.style.display = active ? 'block' : 'none';
    if (editBtn) editBtn.textContent = active ? '✏️ 取消' : '✏️ 修改';
  }

  function cancelShortcutCapture() {
    if (shortcutCaptureHandler) {
      document.removeEventListener('keydown', shortcutCaptureHandler, true);
      shortcutCaptureHandler = null;
    }
    setShortcutCapturing(false);
    loadPickShortcutConfig().catch(() => {});
  }

  /** 进入按键捕获模式：按下合法组合 → 经 SW chrome.commands.update 改绑 + 广播 */
  function startShortcutCapture() {
    if (shortcutCapturing) { cancelShortcutCapture(); return; }
    setShortcutCapturing(true);
    showShortcutResult('', '');
    shortcutCaptureHandler = (e) => {
      // 捕获阶段拦截，防止 Ctrl+W 等浏览器快捷键在捕获期间误触
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { cancelShortcutCapture(); return; }
      const k = e.key || '';
      if (['Control', 'Shift', 'Alt', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock'].includes(k)) return;
      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Command');
      const combo = [...mods, eventKeyToShortcutName(e)].join('+');
      const normalized = Storage.normalizeShortcut(combo);
      if (!normalized) {
        showShortcutResult('❌ 该组合不可用：须包含 Ctrl/Alt/Command（可选 Shift）与一个按键，且不得为 Tab/Esc/Enter', 'err');
        return; // 保持捕获，等待合法组合
      }
      commitShortcut(normalized);
    };
    document.addEventListener('keydown', shortcutCaptureHandler, true);
  }

  /** 提交快捷键：SW 改绑浏览器级键位（冲突等错误回显）+ 持久化 + 广播 */
  async function commitShortcut(shortcut) {
    try {
      const r = await sendMessageWithTimeout({ action: 'setElementPickerShortcut', shortcut }, 15000);
      if (r?.success) {
        renderPickShortcutDisplay(r.data?.shortcut || shortcut);
        showShortcutResult(`✅ 快捷键已生效：${r.data?.shortcut || shortcut}`, 'ok');
      } else {
        const err = r?.error || '保存失败';
        const friendly = /already in use|已.*占用/i.test(err)
          ? '该组合已被其他扩展占用，请换一个'
          : `保存失败：${err}`;
        showShortcutResult(`❌ ${friendly}`, 'err');
      }
    } catch (e) {
      showShortcutResult(`❌ ${e.message || '保存失败'}`, 'err');
    } finally {
      cancelShortcutCapture();
    }
  }

  /** 恢复默认（mac ⌘+Shift+X / 其他平台 Ctrl+Shift+X） */
  async function resetShortcut() {
    showShortcutResult('', '');
    await commitShortcut(Storage.detectDefaultShortcut());
  }

  async function loadPickShortcutConfig() {
    try {
      const shortcut = await withTimeout(
        Storage.getElementPickerShortcut(),
        STORAGE_READ_TIMEOUT,
        '读取快捷键配置',
      );
      renderPickShortcutDisplay(shortcut);
      checkShortcutBindingDiff(shortcut).catch(() => {});
    } catch (e) {
      console.warn('[TaskPlugin] 读取快捷键配置失败:', e.message);
    }
  }

  /**
   * OPT-20260806-048: 对比「浏览器实际绑定（chrome://extensions/shortcuts 手动改绑）
   * vs 配置」，差异时展示提示与「恢复」按钮。旧浏览器/查询失败静默隐藏。
   */
  async function checkShortcutBindingDiff(configured) {
    const hintEl = $('#pickShortcutDiffHint');
    if (!hintEl) return;
    hintEl.style.display = 'none';
    hintEl.textContent = '';
    try {
      const r = await sendMessageWithTimeout({ action: 'getElementPickerShortcutStatus' }, 5000);
      if (!r?.success || !r.data || !r.data.differs) return;
      // OPT-20260807-050: 绑定差异警告位于默认收起的快捷键区折叠区内（#shortcutsSection/
      // #shortcutsBody display:none），不展开即错过。检测到差异时自动展开快捷键区并同步
      // 「收起」态，警告展示完由用户手动收起。
      const sec = $('#shortcutsSection');
      const body = $('#shortcutsBody');
      const toggleBtn = $('#btnToggleShortcuts');
      if (sec) sec.style.display = 'block';
      if (body) body.style.display = 'block';
      if (toggleBtn) toggleBtn.textContent = '收起';
      const cfg = r.data.configuredBinding || configured || '';
      const act = r.data.actual || '';
      hintEl.innerHTML =
        `⚠️ 浏览器实际绑定为 <b>${escapeHtml(act)}</b>，与配置 <b>${escapeHtml(cfg)}</b> 不同` +
        `（chrome://extensions/shortcuts 中可能被手动改绑）。` +
        `<a href="#" id="btnPickShortcutRestore" style="margin-left:6px">点此恢复为配置</a>`;
      hintEl.style.display = 'block';
      const restoreBtn = document.getElementById('btnPickShortcutRestore');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          await commitShortcut(configured || Storage.detectDefaultShortcut());
        });
      }
    } catch (e) {
      console.warn('[TaskPlugin] 快捷键绑定差异检查失败:', e.message);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
