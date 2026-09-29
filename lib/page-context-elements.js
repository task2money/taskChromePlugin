/**
 * Alt+Shift+Z 元素子树采集。从 page-context.js 拆出以保持单文件行数上限。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
  function capturePageContextForElementsWithDeps(opts, deps) {
    const roots = Array.isArray(opts.roots)
      ? opts.roots.filter((el) => el && el.nodeType === 1 && !deps.isPluginChromeUi(el))
      : [];
    if (!roots.length) return deps.capturePageContext(opts);

    let url = opts.url;
    let title = opts.title;
    if (url == null && typeof location !== 'undefined') url = location.href;
    if (title == null && typeof document !== 'undefined') title = document.title;

    const stamp = opts.stampNids !== false;
    if (stamp) {
      for (const el of roots) deps.stampDomNids(el);
    }

    const raw = roots
      .map((el) => deps.extractVisibleReadableText(el))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const { text, truncated } = deps.truncatePageText(raw, opts.maxRunes);

    let domOutline = [];
    const limit = opts.maxOutlineNodes || deps.maxNodes;
    for (const el of roots) {
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

  const PageContextElements = {
    capture: capturePageContextForElementsWithDeps,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageContextElements;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.PageContextElements = PageContextElements;
  }
}
