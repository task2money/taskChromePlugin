/**
 * Alt+E 建议卡拖拽：把手拖动 → pinned；双击把手复位。
 * 须在 float-page-advisor.js 之前注入；复用 float-boot 的 DRAG_THRESHOLD。
 */

'use strict';

var pageAdvisorPinBySid = new Map();
var pageAdvisorDragActive = null;
var PAGE_ADVISOR_KEYBOARD_NUDGE_PX = 8;

function getPageAdvisorPin(sid) {
  const id = String(sid || '');
  if (!id) return null;
  return pageAdvisorPinBySid.get(id) || null;
}

function setPageAdvisorPin(sid, top, left) {
  const id = String(sid || '');
  if (!id) return;
  pageAdvisorPinBySid.set(id, {
    top: Math.round(Number(top) || 0),
    left: Math.round(Number(left) || 0),
  });
}

function clearPageAdvisorPin(sid) {
  pageAdvisorPinBySid.delete(String(sid || ''));
}

function clearAllPageAdvisorPins() {
  pageAdvisorPinBySid.clear();
}

function isPageAdvisorPinned(sid) {
  return pageAdvisorPinBySid.has(String(sid || ''));
}

function detachPageAdvisorDragListeners() {
  if (!pageAdvisorDragActive) return;
  const st = pageAdvisorDragActive;
  document.removeEventListener('mousemove', st.onMove, true);
  document.removeEventListener('mouseup', st.onUp, true);
  if (st.card) {
    st.card.classList.remove('taskplugin-page-advisor-dragging');
  }
  pageAdvisorDragActive = null;
}

/**
 * @param {HTMLElement} card
 */
function attachPageAdvisorCardDrag(card) {
  if (!card || card.getAttribute('data-drag-bound') === '1') return;
  const handle = card.querySelector('.taskplugin-page-advisor-drag-handle');
  if (!handle) return;
  card.setAttribute('data-drag-bound', '1');

  const threshold = (typeof DRAG_THRESHOLD === 'number') ? DRAG_THRESHOLD : 4;

  handle.addEventListener('keydown', (ev) => {
    const key = ev.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const step = PAGE_ADVISOR_KEYBOARD_NUDGE_PX;
    let dx = 0;
    let dy = 0;
    if (key === 'ArrowUp') dy = -step;
    else if (key === 'ArrowDown') dy = step;
    else if (key === 'ArrowLeft') dx = -step;
    else if (key === 'ArrowRight') dx = step;

    const rect = card.getBoundingClientRect();
    let newLeft = (Number.isFinite(parseInt(card.style.left, 10))
      ? parseInt(card.style.left, 10)
      : rect.left) + dx;
    let newTop = (Number.isFinite(parseInt(card.style.top, 10))
      ? parseInt(card.style.top, 10)
      : rect.top) + dy;
    const w = card.offsetWidth || 260;
    const h = card.offsetHeight || 80;
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - h));
    card.style.left = `${Math.round(newLeft)}px`;
    card.style.top = `${Math.round(newTop)}px`;
    const sid = String(card.getAttribute('data-sid') || '');
    setPageAdvisorPin(sid, newTop, newLeft);
    card.classList.add('taskplugin-page-advisor-pinned');
    if (typeof schedulePageAdvisorLayout === 'function') {
      schedulePageAdvisorLayout();
    } else if (typeof layoutPageAdvisorCards === 'function') {
      layoutPageAdvisorCards();
    }
  });

  handle.addEventListener('dblclick', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const sid = String(card.getAttribute('data-sid') || '');
    clearPageAdvisorPin(sid);
    card.classList.remove('taskplugin-page-advisor-pinned');
    if (typeof schedulePageAdvisorLayout === 'function') {
      schedulePageAdvisorLayout();
    } else if (typeof layoutPageAdvisorCards === 'function') {
      layoutPageAdvisorCards();
    }
  });

  handle.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    detachPageAdvisorDragListeners();

    const startX = ev.clientX;
    const startY = ev.clientY;
    const rect = card.getBoundingClientRect();
    const originLeft = rect.left;
    const originTop = rect.top;
    let moved = false;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        moved = true;
        card.classList.add('taskplugin-page-advisor-dragging');
      }
      let newLeft = originLeft + dx;
      let newTop = originTop + dy;
      const w = card.offsetWidth || 260;
      const h = card.offsetHeight || 80;
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - h));
      card.style.left = `${Math.round(newLeft)}px`;
      card.style.top = `${Math.round(newTop)}px`;
    };

    const onUp = () => {
      detachPageAdvisorDragListeners();
      if (!moved) return;
      const sid = String(card.getAttribute('data-sid') || '');
      const left = parseInt(card.style.left, 10);
      const top = parseInt(card.style.top, 10);
      if (!Number.isNaN(left) && !Number.isNaN(top)) {
        setPageAdvisorPin(sid, top, left);
        card.classList.add('taskplugin-page-advisor-pinned');
      }
      if (typeof schedulePageAdvisorLayout === 'function') {
        schedulePageAdvisorLayout();
      }
    };

    pageAdvisorDragActive = { card, onMove, onUp };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  });
}

function bindPageAdvisorCardDrags(root) {
  if (!root) return;
  root.querySelectorAll('.taskplugin-page-advisor-float-card').forEach((card) => {
    attachPageAdvisorCardDrag(card);
  });
}
