/**
 * 浮窗 / 使用说明 / Alt+E 层等 role=dialog 的焦点陷阱与 Esc 关闭。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * @param {ParentNode} container
 * @returns {HTMLElement[]}
 */
function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (!el || typeof el.focus !== 'function') return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const ti = el.getAttribute('tabindex');
    if (ti === '-1') return false;
    return true;
  });
}

/**
 * @param {ParentNode} container
 * @returns {boolean}
 */
function focusFirstFocusable(container) {
  const list = getFocusableElements(container);
  if (!list.length) return false;
  list[0].focus();
  return true;
}

/** @type {{ container: ParentNode, handler: (e: KeyboardEvent) => void, returnFocusEl: (HTMLElement|null) } | null} */
let activeTrap = null;

/**
 * @param {ParentNode} container
 * @param {{ returnFocusEl?: HTMLElement|null, onEscape?: () => void, initialFocus?: HTMLElement|null }} [options]
 */
function activateFocusTrap(container, options = {}) {
  if (!container) return;
  deactivateFocusTrap({ restoreFocus: false });

  const returnFocusEl = options.returnFocusEl || null;
  const onEscape = typeof options.onEscape === 'function' ? options.onEscape : null;

  const handler = (e) => {
    if (e.key === 'Escape') {
      if (!onEscape) return;
      e.preventDefault();
      e.stopPropagation();
      deactivateFocusTrap({ restoreFocus: false });
      onEscape();
      if (returnFocusEl && typeof returnFocusEl.focus === 'function') {
        returnFocusEl.focus();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements(container);
    if (focusable.length < 2) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handler, true);
  }
  activeTrap = { container, handler, returnFocusEl };

  const initial = options.initialFocus;
  if (initial && typeof initial.focus === 'function') {
    initial.focus();
  } else {
    focusFirstFocusable(container);
  }
}

/**
 * @param {{ restoreFocus?: boolean }} [opts]
 */
function deactivateFocusTrap(opts = {}) {
  const restore = opts.restoreFocus !== false;
  if (!activeTrap) return;
  const { handler, returnFocusEl } = activeTrap;
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', handler, true);
  }
  activeTrap = null;
  if (restore && returnFocusEl && typeof returnFocusEl.focus === 'function') {
    returnFocusEl.focus();
  }
}

function isFocusTrapActiveFor(container) {
  return !!(activeTrap && activeTrap.container === container);
}

const DialogFocusTrap = {
  FOCUSABLE_SELECTOR,
  getFocusableElements,
  focusFirstFocusable,
  activateFocusTrap,
  deactivateFocusTrap,
  isFocusTrapActiveFor,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DialogFocusTrap;
}
if (typeof globalThis !== 'undefined') {
  globalThis.DialogFocusTrap = DialogFocusTrap;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    FOCUSABLE_SELECTOR, getFocusableElements, focusFirstFocusable,
    activeTrap, activateFocusTrap, deactivateFocusTrap, isFocusTrapActiveFor,
  });
}
}
