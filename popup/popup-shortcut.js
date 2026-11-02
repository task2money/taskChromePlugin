/** Popup 元素拾取快捷键 + OAuth 登录/登出（OPT-20260821-004 split）. */
  // ---- 元素拾取快捷键自定义（默认 Alt+X，可改任意组合）----

  /** 事件键名 → Chrome 命令键名（ArrowUp→Up、,→Comma、.→Period、空格→Space） */
  function eventKeyToShortcutName(e) {
    const k = e.key || '';
    if (k === ' ') return 'Space';
    if (k.startsWith('Arrow')) return k.slice(5);
    if (k === ',') return 'Comma';
    if (k === '.') return 'Period';
    if (k === '`' || e.code === 'Backquote') return 'Backquote';
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
    if (editBtn) {
      // popup.html 保证 lib/i18n-tx.js 先于本脚本加载，直接取全局 tx，不再留运行时兜底
      editBtn.textContent = tx(active ? 'popupPickShortcutCancel' : 'popupPickShortcutEdit');
    }
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
        showShortcutResult(tx('popupShortcutInvalidCombo'), 'err');
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
        showShortcutResult(tx('popupShortcutApplied', { shortcut: r.data?.shortcut || shortcut }), 'ok');
      } else {
        const err = r?.error || tx('popupSaveFailed');
        const friendly = /already in use|已.*占用/i.test(err)
          ? tx('popupShortcutInUse')
          : tx('popupShortcutSaveFailedWith', { msg: err });
        showShortcutResult(`❌ ${friendly}`, 'err');
      }
    } catch (e) {
      showShortcutResult(`❌ ${e.message || tx('popupSaveFailed')}`, 'err');
    } finally {
      cancelShortcutCapture();
    }
  }

  /** 恢复默认（Alt+X） */
  async function resetShortcut() {
    showShortcutResult('', '');
    await commitShortcut(Storage.detectDefaultShortcut());
  }

  async function loadPickShortcutConfig() {
    try {
      const shortcut = await withTimeout(
        Storage.getElementPickerShortcut(),
        STORAGE_READ_TIMEOUT,
        tx('opReadShortcutCfg'),
      );
      renderPickShortcutDisplay(shortcut);
      checkShortcutBindingDiff(shortcut).catch(() => {});
    } catch (e) {
      console.warn('[TaskPlugin] 读取快捷键配置失败:', e.message);
    }
  }

  /**
   * 折叠态绑定差异徽标：只在「快捷键」标题旁提示，**不自动展开**折叠区
   * （快捷键区默认处于收起状态）。展开后由 #pickShortcutDiffHint 展示详情。
   */
  function setShortcutDiffBadge(visible) {
    const badge = $('#shortcutDiffBadge');
    if (!badge) return;
    badge.hidden = !visible;
    if (!visible) {
      badge.textContent = '';
      badge.removeAttribute('title');
      badge.removeAttribute('aria-label');
      return;
    }
    badge.textContent = tx('popupShortcutDiffBadge');
    badge.title = tx('popupShortcutDiffBadgeAria');
    badge.setAttribute('aria-label', badge.title);
  }

  /**
   * OPT-20260806-048: 对比「浏览器实际绑定（chrome://extensions/shortcuts 手动改绑）
   * vs 配置」，差异时在折叠标题旁亮 ⚠️ 徽标并在折叠区内展示提示与「恢复」按钮。
   * 旧浏览器/查询失败静默隐藏。
   */
  async function checkShortcutBindingDiff(configured) {
    const hintEl = $('#pickShortcutDiffHint');
    if (!hintEl) return;
    hintEl.style.display = 'none';
    hintEl.textContent = '';
    try {
      const r = await sendMessageWithTimeout({ action: 'getElementPickerShortcutStatus' }, 5000);
      if (!r?.success || !r.data || !r.data.differs) { setShortcutDiffBadge(false); return; }
      // 用户要求快捷键区默认收起：差异只点亮折叠标题徽标，不展开 #shortcutsBody；
      // 展开后用户才能看到下方差异详情与「点此恢复」。
      setShortcutDiffBadge(true);
      const cfg = r.data.configuredBinding || configured || '';
      const act = r.data.actual || '';
      hintEl.innerHTML =
        tx('popupShortcutMismatchHtml', { actual: escapeHtml(act), configured: escapeHtml(cfg) }) +
        `<a href="#" id="btnPickShortcutRestore" style="margin-left:6px">${tx('popupShortcutRestoreLink')}</a>`;
      hintEl.style.display = 'block';
      const restoreBtn = document.getElementById('btnPickShortcutRestore');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          await commitShortcut(configured || Storage.detectDefaultShortcut());
        });
      }
    } catch (e) {
      setShortcutDiffBadge(false);
      console.warn('[TaskPlugin] 快捷键绑定差异检查失败:', e.message);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
