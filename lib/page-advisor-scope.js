/**
 * Alt+Shift+Z 选区边界：编号不重复，标记必须落在选中根子树内。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
  const PA_SCOPE_NID_ATTR = 'data-taskplugin-nid';

  function paScopeAttr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    const v = el.getAttribute(name);
    return v == null ? '' : String(v);
  }

  function paScopeNidTaken(doc, nid, attr) {
    if (!doc || typeof doc.querySelector !== 'function') return false;
    const id = String(nid).replace(/"/g, '');
    try {
      return !!doc.querySelector(`[${attr}="${id}"]`);
    } catch (_) {
      return false;
    }
  }

  /**
   * 新编号避开本文档和顶层文档里已有的 data-taskplugin-nid。
   * 多次打标共用同一个递增序号，避免多选或二次打标再从 n1 开始。
   * @param {Element} el
   * @param {string} [attr]
   * @returns {string}
   */
  function allocateDomNid(el, attr) {
    const name = attr || PA_SCOPE_NID_ATTR;
    const doc = (el && el.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    const top = typeof document !== 'undefined' ? document : null;
    if (!globalThis.__taskpluginNidSeq) globalThis.__taskpluginNidSeq = 0;
    for (let i = 0; i < 8000; i += 1) {
      globalThis.__taskpluginNidSeq += 1;
      const nid = `n${globalThis.__taskpluginNidSeq}`;
      if (paScopeNidTaken(doc, nid, name)) continue;
      if (top && top !== doc && paScopeNidTaken(top, nid, name)) continue;
      return nid;
    }
    globalThis.__taskpluginNidSeq += 1;
    return `n${globalThis.__taskpluginNidSeq}`;
  }

  function scopeContains(root, el) {
    if (!root || !el) return false;
    if (typeof root.contains === 'function') return root.contains(el);
    let cur = el;
    while (cur) {
      if (cur === root) return true;
      cur = cur.parentElement || null;
    }
    return false;
  }

  /**
   * 只在选中根子树里找编号。根自身的属性 querySelector 匹配不到，要单独看。
   * @param {string} nid
   * @param {Element[]} roots
   * @param {string} [attr]
   * @returns {Element|null}
   */
  function queryNidWithinRoots(nid, roots, attr) {
    const name = attr || PA_SCOPE_NID_ATTR;
    const id = String(nid || '').trim().replace(/"/g, '');
    if (!id) return null;
    const list = Array.isArray(roots) ? roots : [];
    for (const root of list) {
      if (!root || root.nodeType !== 1) continue;
      if (paScopeAttr(root, name) === id) return root;
      if (typeof root.querySelector !== 'function') continue;
      let found = null;
      try {
        found = root.querySelector(`[${name}="${id}"]`);
      } catch (_) {
        found = null;
      }
      if (found && scopeContains(root, found)) return found;
    }
    return null;
  }

  function paScopeDepth(root, el) {
    let depth = 0;
    let cur = el;
    while (cur && cur !== root) {
      depth += 1;
      cur = cur.parentElement || null;
      if (depth > 64) break;
    }
    return depth;
  }

  /**
   * 文案回退取选中根里最深的包含节点，不取包住选区的祖先。
   * @param {Element[]} roots
   * @param {string} needle
   * @returns {Element|null}
   */
  function deepestTextMatch(roots, needle) {
    const text = String(needle || '').trim();
    if (text.length < 2) return null;
    let best = null;
    let bestDepth = -1;
    const list = Array.isArray(roots) ? roots : [];
    for (const root of list) {
      if (!root || root.nodeType !== 1) continue;
      const nodes = [root];
      if (typeof root.querySelectorAll === 'function') {
        try {
          nodes.push(...Array.from(root.querySelectorAll('*')));
        } catch (_) { /* ignore */ }
      }
      for (const el of nodes) {
        if (!scopeContains(root, el)) continue;
        const t = String(el.textContent || '').replace(/\s+/g, ' ');
        if (!t.includes(text)) continue;
        const depth = paScopeDepth(root, el);
        if (depth > bestDepth) {
          best = el;
          bestDepth = depth;
        }
      }
    }
    return best;
  }

  /**
   * 大纲 parent_nid 指向选区外时留空，避免模型去标祖先。
   * @param {Element|null} captureRoot
   * @param {Element|null} parentEl
   * @param {string} parentNid
   * @returns {string}
   */
  function parentNidIfInside(captureRoot, parentEl, parentNid) {
    const nid = String(parentNid || '');
    if (!nid) return '';
    if (!captureRoot || captureRoot.nodeType !== 1) return nid;
    if (scopeContains(captureRoot, parentEl)) return nid;
    return '';
  }

  const PageAdvisorScope = {
    allocateDomNid,
    scopeContains,
    queryNidWithinRoots,
    deepestTextMatch,
    parentNidIfInside,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorScope;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.PageAdvisorScope = PageAdvisorScope;
  }
}
