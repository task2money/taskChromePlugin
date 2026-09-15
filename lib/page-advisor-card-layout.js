/**
 * Alt+E 建议卡定位（纯函数）：贴锚点 / 角落 preferred，仅视口夹紧；不做多卡避让。
 * Content script 与测例共用；挂 globalThis.PageAdvisorCardLayout。
 */

'use strict';

const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 8;

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
 * Place each card at preferred (or pinned) coords; clamp to viewport only.
 * Same preferred → same output (overlap allowed) so cards stay on anchors.
 *
 * @param {object[]} cards
 * @param {{ width:number, height:number }} viewport
 * @param {{ gap?: number, margin?: number }} [opts]
 * @returns {object[]}
 */
function resolveAdvisorCardPositions(cards, viewport, opts) {
  const margin = Number.isFinite(opts?.margin) ? opts.margin : DEFAULT_MARGIN;
  const list = Array.isArray(cards) ? cards.slice() : [];
  list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  const out = list.map((card) => {
    if (!card) return card;
    const width = Math.max(1, Number(card.width) || 260);
    const height = Math.max(1, Number(card.height) || 80);
    const isPinned = card.mode === 'pinned';
    const rawTop = isPinned && Number.isFinite(card.top)
      ? card.top
      : card.preferredTop;
    const rawLeft = isPinned && Number.isFinite(card.left)
      ? card.left
      : card.preferredLeft;
    const clamped = clampRectToViewport(
      {
        top: Number.isFinite(rawTop) ? rawTop : margin,
        left: Number.isFinite(rawLeft) ? rawLeft : margin,
        width,
        height,
      },
      viewport,
      margin,
    );
    return {
      ...card,
      top: clamped.top,
      left: clamped.left,
      width,
      height,
    };
  });

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
