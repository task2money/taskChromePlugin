'use strict';

function skillRows(list) {
  const out = [];
  (list.children || []).forEach((ch, i) => {
    if (i === 0) return;
    const cls = String(ch.className || '');
    if (cls.includes('popup-skill-group')) {
      (ch.children || []).forEach((gch) => {
        if (String(gch.className || '').includes('popup-skill-row')) out.push(gch);
      });
    } else if (cls.includes('popup-skill-row')) {
      out.push(ch);
    }
  });
  return out;
}

function noneRow(list) {
  return list.children[0];
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
