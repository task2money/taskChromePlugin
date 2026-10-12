/**
 * 矩形相交采集。从 page-context.js 拆出以保持单文件行数上限。
 * Alt+Shift+Z 点选重试不再走这条路径；保留给仍传入 region 的调用。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
  function capturePageContextInRectWithDeps(opts, deps) {
    const region = opts.region;
    if (!region || !(Number(region.width) > 0) || !(Number(region.height) > 0)) {
      return deps.capturePageContext(opts);
    }

    function intersects(a, b) {
      if (!a || !b) return false;
      return a.left < b.left + b.width
        && a.left + a.width > b.left
        && a.top < b.top + b.height
        && a.top + a.height > b.top;
    }

    const getRect = typeof opts.getBoundingClientRect === 'function'
      ? opts.getBoundingClientRect
      : (el) => {
        if (el && typeof el.getBoundingClientRect === 'function') {
          try {
            const r = el.getBoundingClientRect();
            return {
              left: Number(r.left) || 0,
              top: Number(r.top) || 0,
              width: Number(r.width) || 0,
              height: Number(r.height) || 0,
            };
          } catch (_) { /* jsdom */ }
        }
        return { left: 0, top: 0, width: 0, height: 0 };
      };

    let url = opts.url;
    let title = opts.title;
    let root = opts.root;
    if (url == null && typeof location !== 'undefined') url = location.href;
    if (title == null && typeof document !== 'undefined') title = document.title;
    if (root == null && typeof document !== 'undefined') {
      root = document.body || document.documentElement;
    }
    if (!root) {
      return {
        url: String(url || ''),
        title: String(title || ''),
        pageText: '',
        pageTextTruncated: false,
        domOutline: [],
        regionScoped: true,
      };
    }

    const scope = root.nodeType === 9 ? root.body || root.documentElement : root;
    const hits = [];
    const iframeTexts = [];
    const stack = scope ? [scope] : [];
    while (stack.length) {
      const el = stack.pop();
      if (!el || el.nodeType !== 1) continue;
      const tag = String(el.tagName || '').toUpperCase();
      const rect = getRect(el);
      if (tag === 'IFRAME' && intersects(region, rect)) {
        let childDoc = null;
        try {
          childDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document) || null;
        } catch (_) {
          childDoc = null;
        }
        if (childDoc) {
          const childRoot = childDoc.body || childDoc.documentElement;
          if (childRoot) {
            const nested = capturePageContextInRectWithDeps({
              ...opts,
              root: childRoot,
              url: opts.url,
              title: opts.title,
              region: {
                left: (Number(region.left) || 0) - (Number(rect.left) || 0),
                top: (Number(region.top) || 0) - (Number(rect.top) || 0),
                width: Number(region.width) || 0,
                height: Number(region.height) || 0,
              },
              getBoundingClientRect: getRect,
            }, deps);
            if (nested && nested.pageText) {
              iframeTexts.push(String(nested.pageText));
            }
          }
        }
        continue;
      }
      if (deps.isElementSkipped(el)) continue;
      const children = el.children || el.childNodes || [];
      let hasWalkableElementChild = false;
      for (let i = 0; i < children.length; i += 1) {
        const c = children[i];
        if (!c || c.nodeType !== 1) continue;
        const cTag = String(c.tagName || '').toUpperCase();
        if (cTag === 'IFRAME' || !deps.isElementSkipped(c)) {
          hasWalkableElementChild = true;
          break;
        }
      }
      if (intersects(region, rect) && !hasWalkableElementChild) hits.push(el);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]);
      }
    }

    const leafHits = hits.filter((el) => {
      for (const other of hits) {
        if (other === el) continue;
        let p = other.parentElement;
        while (p) {
          if (p === el) return false;
          p = p.parentElement;
        }
      }
      return true;
    });

    const stamp = opts.stampNids !== false;
    if (stamp) {
      for (const el of leafHits) {
        deps.stampDomNids(el);
      }
    }

    const raw = leafHits
      .map((el) => deps.extractVisibleReadableText(el))
      .concat(iframeTexts)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const { text, truncated } = deps.truncatePageText(raw, opts.maxRunes);

    let domOutline = [];
    const limit = opts.maxOutlineNodes || deps.maxNodes;
    for (const el of leafHits) {
      const part = deps.captureDomOutline(el, limit);
      domOutline = domOutline.concat(part);
      if (domOutline.length >= limit) {
        domOutline = domOutline.slice(0, limit);
        break;
      }
    }

    return {
      url: String(url || ''),
      title: String(title || ''),
      pageText: text,
      pageTextTruncated: truncated,
      domOutline,
      regionScoped: true,
    };
  }

  const PageContextRect = {
    capture: capturePageContextInRectWithDeps,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageContextRect;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.PageContextRect = PageContextRect;
  }
}
