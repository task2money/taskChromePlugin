'use strict';

/** 侧边栏 iframe 带 ?host=sidepanel 时打上属性，popup-sidepanel.css 才生效。须为外部脚本：MV3 扩展页拦截内联脚本。 */
function applySidepanelHost(search, doc) {
  const query = search == null ? '' : String(search);
  if (query.indexOf('host=sidepanel') === -1) return false;
  const root = doc && doc.documentElement;
  if (!root || typeof root.setAttribute !== 'function') return false;
  root.setAttribute('data-taskplugin-host', 'sidepanel');
  return true;
}

if (typeof document !== 'undefined') {
  applySidepanelHost(typeof location !== 'undefined' ? location.search : '', document);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applySidepanelHost };
}
