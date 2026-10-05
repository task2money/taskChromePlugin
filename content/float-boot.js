/**
 * 浮窗 boot：DOM 与跨文件共享状态。
 * Chrome 多 content script 同 isolated world，共享 `var` / `function`，不共享 let/const。
 */
var __taskpluginFloatSkip = !!document.getElementById('taskplugin-float-root');

// Auth surfaces: hide float ball (no workspace/project). Still mount a muted root
// so other scripts that expect #taskplugin-float-root do not throw.
var __taskpluginOnAuthRoute = (typeof IsAuthRoutePath !== 'undefined'
  && IsAuthRoutePath.isAuthRoutePath
  && IsAuthRoutePath.isAuthRoutePath(location.pathname));

// ---- 创建 DOM ----
var root = document.getElementById('taskplugin-float-root');
var __taskpluginSideHost = document.documentElement.getAttribute('data-taskplugin-host') === 'sidepanel';
if (!root) {
  root = document.createElement('div');
  root.id = 'taskplugin-float-root';
  var __taskpluginMarkupMode = __taskpluginSideHost ? 'form' : 'page';
  root.innerHTML = (typeof FloatPanelMarkup !== 'undefined' && FloatPanelMarkup.html)
    ? FloatPanelMarkup.html(__taskpluginMarkupMode)
    : '';
  var __taskpluginMount = __taskpluginSideHost
    ? (document.getElementById('sp-pane-create') || document.body)
    : document.body;
  __taskpluginMount.appendChild(root);
  if (globalThis.AidevpushI18n && typeof globalThis.AidevpushI18n.applyDom === 'function') {
    globalThis.AidevpushI18n.applyDom(root);
  }
}

if (__taskpluginOnAuthRoute && root) {
  root.setAttribute('data-taskplugin-auth-route', '1');
  root.style.display = 'none';
  root.setAttribute('aria-hidden', 'true');
}

(async function hydrateFloatI18n() {
  try {
    if (globalThis.AidevpushI18n && globalThis.AidevpushI18n.hydrateFromStorage) {
      await globalThis.AidevpushI18n.hydrateFromStorage();
    }
  } catch (_) { /* ignore */ }
  try {
    if (root && globalThis.AidevpushI18n && typeof globalThis.AidevpushI18n.applyDom === 'function') {
      globalThis.AidevpushI18n.applyDom(root);
    }
    if (typeof PluginLocaleSwitcher !== 'undefined' && typeof PluginLocaleSwitcher.syncSelect === 'function') {
      PluginLocaleSwitcher.syncSelect();
    }
  } catch (_) { /* ignore */ }
})();

// 使用说明仅挂扩展弹窗 / DevTools，浮窗不再渲染（与 Popup 重复）。

// ---- Refs ----
var btn = document.getElementById('taskplugin-float-btn');
var panel = document.getElementById('taskplugin-float-panel');
var badge = document.getElementById('taskplugin-login-badge');
var wsSelect = document.getElementById('taskplugin-workspace');
var projectsDiv = document.getElementById('taskplugin-projects');
var submitBtn = document.getElementById('taskplugin-submit');
var resultDiv = document.getElementById('taskplugin-result');
var mergeTarget = document.getElementById('taskplugin-merge-target');
var workBranch = document.getElementById('taskplugin-work-branch');
var repoBasesDiv = document.getElementById('taskplugin-repo-bases');
var gitIdentitiesDiv = document.getElementById('taskplugin-git-identities');
var ownerSelect = document.getElementById('taskplugin-owner');
var assigneesDiv = document.getElementById('taskplugin-assignees');
var titleInput = document.getElementById('taskplugin-title');
var descInput = document.getElementById('taskplugin-desc');
var descResetBtn = document.getElementById('taskplugin-desc-reset');
var progressSelect = document.getElementById('taskplugin-progress');
var deliverableSelect = document.getElementById('taskplugin-deliverable');
var imageSelect = document.getElementById('taskplugin-image');
var imageRequiredMark = document.getElementById('taskplugin-image-required');
var featureParamsSelect = document.getElementById('taskplugin-feature-params');
var personalWrap = document.getElementById('taskplugin-personal-wrap');
var personalConfigSelect = document.getElementById('taskplugin-personal-config');
var dueDateInput = document.getElementById('taskplugin-due-date');
var autoRunInput = document.getElementById('taskplugin-auto-run');
var autoRunHint = document.getElementById('taskplugin-auto-run-hint');
var queuedWrap = document.getElementById('taskplugin-queued-auto-run-wrap');
var queuedInput = document.getElementById('taskplugin-queued-auto-run');
var queuedError = document.getElementById('taskplugin-queued-auto-run-error');
var workspaceScheduleEnabled = false;
var membersData = [];
var gitIdentitiesCache = [];

var adjustModal = document.getElementById('taskplugin-adjust-modal');
var adjustElSummary = document.getElementById('taskplugin-adjust-el-summary');
var adjustInput = document.getElementById('taskplugin-adjust-input');
var adjustCancel = document.getElementById('taskplugin-adjust-cancel');
var adjustConfirm = document.getElementById('taskplugin-adjust-confirm');
var adjustError = document.getElementById('taskplugin-adjust-error');
var adjustShot = document.getElementById('taskplugin-adjust-shot');

var isOpen = false;
if (__taskpluginSideHost && panel) {
  panel.classList.add('taskplugin-open');
  isOpen = true;
}
/** 本次打开浮窗（鉴权/aidev 完成后）的表单快照；创建成功后还原 */
var openSnapshot = null;
var isLoggedIn = false;
var pageToastTimer = null;
var pickMode = false;
/**
 * 快捷键兜底（页内 keydown）：chrome.commands 注册失败/被占用时，
 * 按键事件会穿透到页面，此监听保证所选组合（默认 Alt+X）依然可用。
 * 与 chrome.commands 消息路径共享去抖，防止浏览器命令与 keydown 双触发。
 */
var lastShortcutToggleAt = 0;
var SHORTCUT_DEBOUNCE_MS = 300;
/**
 * 页内兜底监听使用的快捷键组合串（如 'Alt+X' / 'Ctrl+Shift+X' / 'Alt+Z'）。
 * 由 Popup「快捷键」自定义配置决定，默认统一 Alt+X
 * （Storage.getElementPickerShortcut；初始值取默认兜底 storage 读取失败路径）。
 */
var pickShortcutCombo = Storage.detectDefaultShortcut();
var highlightedEls = [];
var highlightDoc = null;
var pendingElementSnapshot = null;
var pendingFrameElement = null;
var pickSource = 'float';
var pickCrossOriginHintShown = false;
/** Cmd/Ctrl 累加多选（同 frame 内，点击顺序） */
var pickSelection = [];
var pickSelectionFrame = null; // Element|null，与第一次累加的 frameElement 对齐
var apiCfg = { baseUrl: 'https://aidevpush.com', token: '' };
var workspacesData = [];
var projectsData = [];
var pendingAidevMatches = null;
var aidevStatusEl = document.getElementById('taskplugin-aidev-status');

/**
 * 带超时的 chrome.runtime.sendMessage 封装
 * 防止 Service Worker 未就绪或 API 调用超时时消息无限挂起导致悬浮球面板卡死
 */
function sendMessageWithTimeout(action, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(typeof tx === 'function' ? tx('commonMessageTimeout', { action: action.action || action }) : `消息超时: ${action.action || action}`));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(action)
        .then((res) => { clearTimeout(timer); resolve(res); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    } catch (syncErr) {
      clearTimeout(timer);
      reject(syncErr);
    }
  });
}

// 分支模板 datalist 预设值前缀（须在 init → seedBranchDatalists 之前初始化）
var PRESET_PREFIX = '__preset:';

function sidePanelOpenHintText() {
  var locale = '';
  try {
    if (globalThis.AidevpushI18n && typeof globalThis.AidevpushI18n.getLocale === 'function') {
      locale = globalThis.AidevpushI18n.getLocale();
    }
  } catch (_) { /* ignore */ }
  if (globalThis.SidePanelBridge && typeof globalThis.SidePanelBridge.sidePanelOpenHint === 'function') {
    return globalThis.SidePanelBridge.sidePanelOpenHint(locale);
  }
  return locale === 'en' ? 'Click the extension icon to open the side panel' : 'sidePanelOpenHint';
}

function openSidePanelFromPage(which) {
  return sendMessageWithTimeout({ action: 'openSidePanel', which: which || 'create' }, 4000).then((res) => {
    if (res && res.success === false && typeof showPageToast === 'function') {
      showPageToast(sidePanelOpenHintText());
    }
    return res;
  }).catch(() => {
    if (typeof showPageToast === 'function') showPageToast(sidePanelOpenHintText());
  });
}

async function readCreateDescription() {
  if (typeof descInput !== 'undefined' && descInput) return descInput.value;
  try {
    const res = await sendMessageWithTimeout({ action: 'getCreateDescription' }, 4000);
    return (res && res.description) || '';
  } catch (_) {
    return '';
  }
}

async function writeCreateDescription(next) {
  const onForm = typeof descInput !== 'undefined' && descInput;
  if (onForm) {
    descInput.value = next;
    if (typeof syncDescResetButton === 'function') syncDescResetButton();
  }
  try {
    const res = await sendMessageWithTimeout({
      action: 'setCreateDescription',
      description: next,
      open: !onForm,
      tabId: globalThis.__taskpluginSidePanelTabId,
    }, 4000);
    if (!onForm && res && res.success === false && typeof showPageToast === 'function') {
      showPageToast(sidePanelOpenHintText());
    }
  } catch (_) {
    if (!onForm && typeof showPageToast === 'function') showPageToast(sidePanelOpenHintText());
  }
}

