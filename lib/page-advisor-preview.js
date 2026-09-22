/**
 * Alt+E 可逆 DOM 预览（纯函数优先）— apply / undo / sanitize。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
const PREVIEW_SID_ATTR = 'data-taskplugin-preview-sid';
const PREVIEW_CLASS_PREFIX = 'taskplugin-preview-';
const INSERT_HTML_ATTR_ALLOW = /^(class|role|type|tabindex|hidden|disabled)$/;

function htmlAttrAllowedForInsert(name) {
  const n = String(name || '').toLowerCase();
  if (!n || n.startsWith('on')) return false;
  if (INSERT_HTML_ATTR_ALLOW.test(n)) return true;
  return n.startsWith('aria-') || n.startsWith('data-taskplugin-');
}

/** Distinct from page-context.js top-level NID_ATTR (shared content-script scope). */
const PREVIEW_NID_ATTR = 'data-taskplugin-nid';

const ALLOWED_OPS = new Set([
  'setText', 'setAttr', 'setStyle', 'addClass', 'hide', 'insertAdjacent',
]);

const ALLOWED_ATTRS = new Set([
  'title', 'placeholder', 'alt', 'href', 'aria-label', 'aria-hidden', 'role',
]);

const ALLOWED_POSITIONS = new Set([
  'beforebegin', 'afterbegin', 'beforeend', 'afterend',
]);

const SENSITIVE_INPUT_TYPES = new Set(['password', 'file', 'hidden']);

/**
 * @param {object[]} ops
 * @returns {object[]}
 */
function sanitizePreviewOps(ops) {
  const list = Array.isArray(ops) ? ops : [];
  const out = [];
  for (const raw of list) {
    if (!raw || out.length >= 8) break;
    const op = String(raw.op || '').trim();
    const nid = String(raw.nid || '').trim();
    if (!nid || !ALLOWED_OPS.has(op)) continue;
    const clean = { op, nid };
    if (op === 'setText') {
      clean.value = String(raw.value ?? '');
    } else if (op === 'setAttr') {
      const attr = String(raw.attr || '').trim();
      if (!attr) continue;
      if (!ALLOWED_ATTRS.has(attr) && !attr.startsWith('aria-')) continue;
      const value = String(raw.value ?? '');
      if (attr === 'href' && /^\s*javascript:/i.test(value)) continue;
      clean.attr = attr;
      clean.value = value;
    } else if (op === 'setStyle') {
      const styles = raw.styles && typeof raw.styles === 'object' ? raw.styles : null;
      if (!styles) continue;
      const next = {};
      for (const [k, v] of Object.entries(styles)) {
        const key = String(k || '').trim();
        if (!key || /[;{}]/.test(key)) continue;
        next[key] = String(v ?? '');
      }
      if (!Object.keys(next).length) continue;
      clean.styles = next;
    } else if (op === 'addClass') {
      const cls = String(raw.value || '').trim();
      if (!cls.startsWith(PREVIEW_CLASS_PREFIX)) continue;
      clean.value = cls;
    } else if (op === 'insertAdjacent') {
      let pos = String(raw.position || 'afterend').trim();
      if (!ALLOWED_POSITIONS.has(pos)) continue;
      const html = String(raw.html || '').trim();
      if (!html || /<script/i.test(html)) continue;
      clean.position = pos;
      clean.html = html;
    }
    out.push(clean);
  }
  return out;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
/**
 * @param {ParentNode|null} root
 * @param {string} anchorText
 * @returns {Element|null}
 */
function findElementByAnchorText(root, anchorText) {
  const anchor = String(anchorText || '').trim();
  if (anchor.length < 2 || !root || typeof root.querySelectorAll !== 'function') {
    return null;
  }
  const matchText = (el) => {
    const t = String(el.textContent || '').replace(/\s+/g, ' ');
    return t.includes(anchor);
  };
  const stamped = root.querySelectorAll(`[${PREVIEW_NID_ATTR}]`);
  for (const el of stamped) {
    if (matchText(el)) return el;
  }
  const fallback = root.querySelectorAll('button, a, [role="button"], input, textarea, label');
  for (const el of fallback) {
    if (typeof el.hasAttribute === 'function' && el.hasAttribute(PREVIEW_NID_ATTR)) continue;
    if (matchText(el)) return el;
  }
  return null;
}

/**
 * @param {Element|null} el
 * @param {Document|ParentNode} [root]
 * @returns {boolean}
 */
function isElementConnected(el, root) {
  if (!el) return false;
  if (typeof el.isConnected === 'boolean') return el.isConnected;
  const doc = root && root.nodeType === 9 ? root : (typeof document !== 'undefined' ? document : null);
  if (doc && doc.body && typeof doc.body.contains === 'function') {
    return doc.body.contains(el);
  }
  return true;
}

/**
 * 目标节点被替换后：undo → 按 anchor_text 重绑 nid → 重新 apply（仅仍勾选的项）。
 * @param {*} session createPreviewSession 返回值
 * @param {object} suggestion
 * @param {{ resolveNid: (nid: string) => Element|null, root?: ParentNode, isSelected?: (id: string) => boolean }} deps
 * @returns {'reapplied'|'stale'|'skip'}
 */
function resolveLiveNid(root, resolveNid, nid) {
  const id = String(nid || '').replace(/"/g, '');
  const direct = resolveNid(id);
  if (isElementConnected(direct, root)) return direct;
  if (root && typeof root.querySelector === 'function') {
    try {
      const found = root.querySelector(`[${PREVIEW_NID_ATTR}="${id}"]`);
      if (isElementConnected(found, root)) return found;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function rebindSuggestionPreview(session, suggestion, deps) {
  const id = String(suggestion?.id || '');
  if (!id || !session?.has(id)) return 'skip';
  const resolveNid = deps.resolveNid;
  const root = deps.root || (typeof document !== 'undefined' ? document : null);
  const ops = sanitizePreviewOps(suggestion?.preview?.ops || []);
  let stale = false;
  for (const op of ops) {
    const el = resolveLiveNid(root, resolveNid, op.nid);
    if (!el) {
      stale = true;
      break;
    }
  }
  if (!stale) return 'skip';

  session.undoOne(id);
  const selected = typeof deps.isSelected === 'function' ? deps.isSelected(id) : true;
  if (!selected) return 'stale';

  const targetNid = String(suggestion?.target_nid || '').trim();
  let rebound = targetNid ? resolveLiveNid(root, resolveNid, targetNid) : null;
  if (!rebound) {
    rebound = findElementByAnchorText(root, suggestion?.anchor_text);
    if (rebound && targetNid && typeof rebound.setAttribute === 'function') {
      rebound.setAttribute(PREVIEW_NID_ATTR, targetNid.replace(/"/g, ''));
    }
  }
  if (!rebound) return 'stale';

  const applied = session.applySuggestion(suggestion);
  return applied.applied ? 'reapplied' : 'stale';
}

/**
 * @param {{ session: ReturnType<typeof createPreviewSession>, getSuggestions: () => object[], resolveNid: (nid: string) => Element|null, isSelected?: (id: string) => boolean, document?: Document, debounceMs?: number }} deps
 */
function createPreviewDomWatcher(deps) {
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  const debounceMs = Math.max(0, Number(deps.debounceMs) || 80);
  let timer = null;
  let observer = null;

  function reconcile() {
    const list = typeof deps.getSuggestions === 'function' ? deps.getSuggestions() : [];
    for (const sug of list) {
      try {
        rebindSuggestionPreview(deps.session, sug, {
          resolveNid: deps.resolveNid,
          root: doc,
          isSelected: deps.isSelected,
        });
      } catch (_) { /* ignore */ }
    }
  }

  function start() {
    if (!doc || typeof MutationObserver === 'undefined') return;
    stop();
    observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        reconcile();
      }, debounceMs);
    });
    const target = doc.documentElement || doc.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { start, stop, reconcile };
}

function isSensitiveControl(el) {
  if (!el || el.nodeType !== 1) return true;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT') {
    const t = String(el.type || el.getAttribute?.('type') || 'text').toLowerCase();
    if (SENSITIVE_INPUT_TYPES.has(t)) return true;
  }
  return false;
}

/**
 * @param {string} html
 * @param {Document} doc
 * @returns {Element|null}
 */
function sanitizeInsertHtml(html, doc) {
  const wrap = doc.createElement('div');
  // XSS-OK: detached parse then allowlist tags/attrs; scripts/event handlers stripped
  wrap.innerHTML = String(html || '');
  const allowed = new Set(['SPAN', 'DIV', 'BUTTON', 'STRONG', 'EM', 'B', 'I', 'P']);
  const walk = (node) => {
    const kids = Array.from(node.childNodes || []);
    for (const child of kids) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) {
        child.remove();
        continue;
      }
      const tag = String(child.tagName || '').toUpperCase();
      if (!allowed.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes || [])) {
        if (!htmlAttrAllowedForInsert(attr.name)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(wrap);
  const first = wrap.firstElementChild;
  return first || null;
}

/**
 * Create a preview session controller.
 * @param {{ resolveNid: (nid: string) => Element|null, document?: Document }} deps
 */
function createPreviewSession(deps) {
  const resolveNid = deps.resolveNid;
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  /** @type {Map<string, Function[]>} */
  const stacks = new Map();

  function undoOne(suggestionId) {
    const id = String(suggestionId || '');
    const stack = stacks.get(id);
    if (!stack) return;
    while (stack.length) {
      const fn = stack.pop();
      try {
        fn();
      } catch (_) { /* ignore */ }
    }
    stacks.delete(id);
  }

  function undoAll() {
    for (const id of Array.from(stacks.keys())) {
      undoOne(id);
    }
  }

  function applySuggestion(suggestion) {
    const id = String(suggestion?.id || '');
    if (!id) return { applied: false, reason: 'no-id' };
    if (stacks.has(id)) {
      return { applied: true, reason: 'already' };
    }
    const ops = sanitizePreviewOps(suggestion?.preview?.ops || []);
    if (!ops.length) {
      return { applied: false, reason: 'no-ops' };
    }
    const undos = [];
    for (const op of ops) {
      const el = resolveNid(op.nid);
      if (!el || isSensitiveControl(el)) {
        continue;
      }
      try {
        if (op.op === 'setText') {
          const prev = el.textContent;
          el.textContent = op.value;
          el.setAttribute(PREVIEW_SID_ATTR, id);
          undos.push(() => {
            el.textContent = prev;
            el.removeAttribute(PREVIEW_SID_ATTR);
          });
        } else if (op.op === 'setAttr') {
          const had = el.hasAttribute(op.attr);
          const prev = el.getAttribute(op.attr);
          el.setAttribute(op.attr, op.value);
          el.setAttribute(PREVIEW_SID_ATTR, id);
          undos.push(() => {
            if (had) el.setAttribute(op.attr, prev);
            else el.removeAttribute(op.attr);
            el.removeAttribute(PREVIEW_SID_ATTR);
          });
        } else if (op.op === 'setStyle') {
          const prev = {};
          for (const [k, v] of Object.entries(op.styles)) {
            prev[k] = el.style[k];
            el.style[k] = v;
          }
          el.setAttribute(PREVIEW_SID_ATTR, id);
          undos.push(() => {
            for (const [k, v] of Object.entries(prev)) {
              el.style[k] = v || '';
            }
            el.removeAttribute(PREVIEW_SID_ATTR);
          });
        } else if (op.op === 'addClass') {
          el.classList.add(op.value);
          el.setAttribute(PREVIEW_SID_ATTR, id);
          undos.push(() => {
            el.classList.remove(op.value);
            el.removeAttribute(PREVIEW_SID_ATTR);
          });
        } else if (op.op === 'hide') {
          const prevDisplay = el.style.display;
          const prevVis = el.style.visibility;
          el.style.visibility = 'hidden';
          el.setAttribute(PREVIEW_SID_ATTR, id);
          undos.push(() => {
            el.style.display = prevDisplay;
            el.style.visibility = prevVis;
            el.removeAttribute(PREVIEW_SID_ATTR);
          });
        } else if (op.op === 'insertAdjacent' && doc) {
          const node = sanitizeInsertHtml(op.html, doc);
          if (!node) continue;
          node.setAttribute(PREVIEW_SID_ATTR, id);
          el.insertAdjacentElement(op.position, node);
          undos.push(() => {
            try {
              node.remove();
            } catch (_) { /* ignore */ }
          });
        }
      } catch (_) { /* skip op */ }
    }
    if (!undos.length) {
      return { applied: false, reason: 'no-target' };
    }
    stacks.set(id, undos);
    return { applied: true, reason: 'ok' };
  }

  return {
    applySuggestion,
    undoOne,
    undoAll,
    sanitizePreviewOps,
    has(id) {
      return stacks.has(String(id || ''));
    },
  };
}

const PageAdvisorPreview = {
  PREVIEW_SID_ATTR,
  PREVIEW_CLASS_PREFIX,
  NID_ATTR: PREVIEW_NID_ATTR,
  sanitizePreviewOps,
  htmlAttrAllowedForInsert,
  findElementByAnchorText,
  isElementConnected,
  rebindSuggestionPreview,
  createPreviewDomWatcher,
  isSensitiveControl,
  sanitizeInsertHtml,
  createPreviewSession,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorPreview;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorPreview = PageAdvisorPreview;
}
if (typeof globalThis !== 'undefined') {
    Object.assign(globalThis, {
    PREVIEW_SID_ATTR, PREVIEW_CLASS_PREFIX, PREVIEW_NID_ATTR, ALLOWED_OPS,
    ALLOWED_ATTRS, ALLOWED_POSITIONS, SENSITIVE_INPUT_TYPES,
    sanitizePreviewOps, findElementByAnchorText, isElementConnected,
    resolveLiveNid, rebindSuggestionPreview, createPreviewDomWatcher,
    isSensitiveControl, sanitizeInsertHtml, createPreviewSession,
    htmlAttrAllowedForInsert,
  });
}
}
