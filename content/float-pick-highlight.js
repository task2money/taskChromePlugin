/** Element-pick highlight box. Inject before content/float-pick.js. */

function isPluginDom(node) {
  if (!node || node.nodeType !== 1) return true;
  if (node === root || root.contains(node)) return true;
  if (typeof node.closest === 'function' && node.closest('#taskplugin-float-root')) return true;
  return false;
}

function ensureHighlightStyle(doc) {
  if (!doc || doc.getElementById('taskplugin-el-hl-style')) return;
  const s = doc.createElement('style');
  s.id = 'taskplugin-el-hl-style';
  s.textContent = 'html.taskplugin-picking .taskplugin-el-highlight{outline:2px solid #89b4fa!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(137,180,250,.35)!important;}';
  (doc.head || doc.documentElement).appendChild(s);
}

function clearHighlight() {
  for (const el of highlightedEls) {
    try {
      el.classList.remove('taskplugin-el-highlight');
    } catch (_) { /* detached */ }
  }
  highlightedEls = [];
  highlightDoc = null;
}

function applyHighlightMany(els, doc) {
  const list = (Array.isArray(els) ? els : [els]).filter((el) => el && el.nodeType === 1);
  if (list.length === 0) {
    clearHighlight();
    return;
  }
  const same =
    list.length === highlightedEls.length
    && list.every((el, i) => el === highlightedEls[i]);
  if (same) return;
  clearHighlight();
  const owner = doc || list[0].ownerDocument || document;
  ensureHighlightStyle(owner);
  highlightDoc = owner;
  for (const el of list) {
    el.classList.add('taskplugin-el-highlight');
    highlightedEls.push(el);
  }
}

function applyHighlight(el, doc) {
  applyHighlightMany(el ? [el] : [], doc);
}
