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

  const PA_SCOPE_MAX_FRAME_DEPTH = 3;

  function paScopeIsFrame(el) {
    return !!el && el.nodeType === 1 && String(el.tagName || '').toUpperCase() === 'IFRAME';
  }

  /** 同源 iframe 的子文档；跨域时读 contentDocument 会抛错，按「没有子文档」处理。 */
  function paScopeSameOriginDocument(frame) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) return doc;
    } catch (_) {
      /* 跨域 iframe：顶层页面拿不到子文档，交给跨域选择那条路 */
    }
    return null;
  }

  /** 同一文档里的两个矩形是否相交；量不到矩形时按相交处理，宁可多采也不漏。 */
  function paScopeRectsIntersect(outer, inner) {
    if (!outer || !inner) return true;
    if (!(Number(inner.width) > 0) && !(Number(inner.height) > 0)) return false;
    return !(
      inner.bottom <= outer.top
      || inner.top >= outer.bottom
      || inner.right <= outer.left
      || inner.left >= outer.right
    );
  }

  function paScopeCollectFrameRoots(root, depth, seen, out) {
    if (!root || depth > PA_SCOPE_MAX_FRAME_DEPTH) return;
    const frames = [];
    if (paScopeIsFrame(root)) frames.push(root);
    if (typeof root.querySelectorAll === 'function') {
      try {
        for (const el of Array.from(root.querySelectorAll('iframe'))) {
          if (paScopeIsFrame(el)) frames.push(el);
        }
      } catch (_) {
        /* 采不到子 iframe 就只按本文档算 */
      }
    }
    if (!frames.length) return;
    const rootRect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    for (const frame of frames) {
      const doc = paScopeSameOriginDocument(frame);
      if (!doc) continue;
      const frameRoot = doc.documentElement;
      if (!frameRoot || seen.has(frameRoot)) continue;
      const frameRect = typeof frame.getBoundingClientRect === 'function' ? frame.getBoundingClientRect() : null;
      if (!paScopeRectsIntersect(rootRect, frameRect)) continue;
      seen.add(frameRoot);
      out.push(frameRoot);
      paScopeCollectFrameRoots(frameRoot, depth + 1, seen, out);
    }
  }

  /**
   * 点选包住 iframe 的容器时，iframe 的子文档不在 `root.querySelector` 能到的范围里，
   * 编号与文案都会落空。把与选区矩形相交的同源 iframe 子文档根一并当成选区根，
   * 后续查编号、找文案、采大纲都按同一份根列表走。
   * @param {Element[]} roots
   * @returns {Element[]}
   */
  function scopeRootsWithFrames(roots) {
    const list = Array.isArray(roots) ? roots.filter((el) => el && el.nodeType === 1) : [];
    const out = list.slice();
    const seen = new Set(out);
    for (const root of list) paScopeCollectFrameRoots(root, 0, seen, out);
    return out;
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
    scopeRootsWithFrames,
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
