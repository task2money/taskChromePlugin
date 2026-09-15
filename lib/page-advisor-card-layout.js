/**
 * Alt+E 建议卡碰撞避让（纯函数，可 Node 单测）。
 * Content script 与测例共用；挂 globalThis.PageAdvisorCardLayout。
 */

'use strict';

const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 8;
const MAX_RESOLVE_ITERS = 24;

/**
 * @param {{ top:number, left:number, width:number, height:number }} a
 * @param {{ top:number, left:number, width:number, height:number }} b
 * @param {number} [gap]
 * @returns {boolean}
 */
function rectsOverlap(a, b, gap) {
  const g = Number.isFinite(gap) ? gap : DEFAULT_GAP;
  if (!a || !b) return false;
  const aw = a.width || 0;
  const ah = a.height || 0;
  const bw = b.width || 0;
  const bh = b.height || 0;
  return !(
    a.left + aw + g <= b.left
    || b.left + bw + g <= a.left
    || a.top + ah + g <= b.top
    || b.top + bh + g <= a.top
  );
}

/**
 * @param {{ top:number, left:number, width:number, height:number }} rect
 * @param {{ width:number, height:number }} viewport
 * @param {number} [margin]
 */
function clampRectToViewport(rect, viewport, margin) {
  const m = Number.isFinite(margin) ? margin : DEFAULT_MARGIN;
  const vw = Math.max(0, Number(viewport?.width) || 0);
  const vh = Math.max(0, Number(viewport?.height) || 0);
  const w = Math.max(1, Number(rect.width) || 1);
  const h = Math.max(1, Number(rect.height) || 1);
  let left = Number(rect.left) || 0;
  let top = Number(rect.top) || 0;
  const maxLeft = Math.max(m, vw - w - m);
  const maxTop = Math.max(m, vh - h - m);
  left = Math.min(Math.max(m, left), maxLeft);
  top = Math.min(Math.max(m, top), maxTop);
  return { top, left, width: w, height: h };
}

/**
 * @param {object} card
 * @param {{ top:number, left:number, width:number, height:number }[]} occupied
 * @param {{ width:number, height:number }} viewport
 * @param {number} gap
 * @param {number} margin
 */
function deconflict(card, occupied, viewport, gap, margin) {
  let top = Number(card.preferredTop);
  let left = Number(card.preferredLeft);
  if (!Number.isFinite(top)) top = margin;
  if (!Number.isFinite(left)) left = margin;
  const width = Math.max(1, Number(card.width) || 260);
  const height = Math.max(1, Number(card.height) || 80);

  let rect = clampRectToViewport({ top, left, width, height }, viewport, margin);

  for (let i = 0; i < MAX_RESOLVE_ITERS; i += 1) {
    let hit = null;
    for (const o of occupied) {
      if (rectsOverlap(rect, o, gap)) {
        hit = o;
        break;
      }
    }
    if (!hit) break;

    // Prefer push down past the blocker
    const downTop = hit.top + hit.height + gap;
    let next = clampRectToViewport(
      { top: downTop, left: rect.left, width, height },
      viewport,
      margin,
    );
    if (!occupied.some((o) => rectsOverlap(next, o, gap))) {
      rect = next;
      continue;
    }

    // Try push up
    const upTop = hit.top - height - gap;
    next = clampRectToViewport(
      { top: upTop, left: rect.left, width, height },
      viewport,
      margin,
    );
    if (!occupied.some((o) => rectsOverlap(next, o, gap))) {
      rect = next;
      continue;
    }

    // Horizontal flip / nudge
    const rightLeft = hit.left + hit.width + gap;
    next = clampRectToViewport(
      { top: rect.top, left: rightLeft, width, height },
      viewport,
      margin,
    );
    if (!occupied.some((o) => rectsOverlap(next, o, gap))) {
      rect = next;
      continue;
    }

    const leftLeft = hit.left - width - gap;
    next = clampRectToViewport(
      { top: rect.top, left: leftLeft, width, height },
      viewport,
      margin,
    );
    if (!occupied.some((o) => rectsOverlap(next, o, gap))) {
      rect = next;
      continue;
    }

    // Last resort: step down by gap from current
    rect = clampRectToViewport(
      { top: rect.top + height + gap, left: rect.left, width, height },
      viewport,
      margin,
    );
  }

  return { ...card, top: rect.top, left: rect.left, width, height };
}

/**
 * @param {object[]} cards
 * @param {{ width:number, height:number }} viewport
 * @param {{ gap?: number, margin?: number }} [opts]
 * @returns {object[]}
 */
function resolveAdvisorCardPositions(cards, viewport, opts) {
  const gap = Number.isFinite(opts?.gap) ? opts.gap : DEFAULT_GAP;
  const margin = Number.isFinite(opts?.margin) ? opts.margin : DEFAULT_MARGIN;
  const list = Array.isArray(cards) ? cards.slice() : [];
  list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  const occupied = [];
  const out = [];

  // Place pinned first so they occupy space for auto cards
  const pinned = list.filter((c) => c && c.mode === 'pinned');
  const rest = list.filter((c) => c && c.mode !== 'pinned');

  for (const card of pinned) {
    const width = Math.max(1, Number(card.width) || 260);
    const height = Math.max(1, Number(card.height) || 80);
    const clamped = clampRectToViewport(
      {
        top: Number.isFinite(card.top) ? card.top : card.preferredTop,
        left: Number.isFinite(card.left) ? card.left : card.preferredLeft,
        width,
        height,
      },
      viewport,
      margin,
    );
    const placed = {
      ...card,
      mode: 'pinned',
      top: clamped.top,
      left: clamped.left,
      width,
      height,
    };
    occupied.push(clamped);
    out.push(placed);
  }

  for (const card of rest) {
    const placed = deconflict(card, occupied, viewport, gap, margin);
    occupied.push({
      top: placed.top,
      left: placed.left,
      width: placed.width,
      height: placed.height,
    });
    out.push(placed);
  }

  out.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  return out;
}

const PageAdvisorCardLayout = {
  DEFAULT_GAP,
  DEFAULT_MARGIN,
  rectsOverlap,
  clampRectToViewport,
  resolveAdvisorCardPositions,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorCardLayout;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorCardLayout = PageAdvisorCardLayout;
}
