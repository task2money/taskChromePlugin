'use strict';

function skillRows(list) {
  const out = [];
  function consider(node) {
    const cls = String(node.className || '');
    if (cls.includes('popup-skill-row') && !cls.includes('popup-skill-row-none')) {
      out.push(node);
      return;
    }
    (node.children || []).forEach(consider);
  }
  (list.children || []).forEach(consider);
  return out;
}

function noneRow(list) {
  const found = [];
  function walk(node) {
    if (String(node.className || '').includes('popup-skill-row-none')) found.push(node);
    (node.children || []).forEach(walk);
  }
  walk(list);
  return found[0];
}

function skillRow(list, index) {
  return skillRows(list)[index];
}

function skillRowByTitle(list, re) {
  return skillRows(list).find((row) => re.test(rowTitle(row).textContent || ''));
}

function rowRadio(row) {
  return row.children[0].children[0];
}

function rowTitle(row) {
  return row.children[0].children[1];
}

function rowActions(row) {
  return row.children[1];
}

function groupEls(list) {
  return (list.children || []).filter((c, i) => i > 0 && String(c.className || '').includes('popup-skill-group'));
}

function categoryPicks(list) {
  const box = (list.children || []).find((c) => String(c.className || '').includes('popup-skill-categories'));
  if (!box) return [];
  return (box.children || []).filter((c) => String(c.className || '').includes('popup-skill-category-pick'));
}

function openCategory(list, tendency) {
  const btn = categoryPicks(list).find((b) => b.getAttribute('data-tendency') === tendency);
  if (!btn) throw new Error(`category not shown: ${tendency}`);
  btn.dispatch('click', { stopPropagation() {} });
}

function backToCategories(list) {
  const btn = (list.children || []).find((c) => String(c.className || '').includes('popup-skill-back'));
  if (!btn) throw new Error('back to categories missing');
  btn.dispatch('click', { stopPropagation() {} });
}

module.exports = {
  skillRows,
  noneRow,
  skillRow,
  skillRowByTitle,
  rowRadio,
  rowTitle,
  rowActions,
  groupEls,
  categoryPicks,
  openCategory,
  backToCategories,
};
