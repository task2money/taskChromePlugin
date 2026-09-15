/**
 * Alt+Shift+E 区域框选几何（纯函数，可 Node 单测）。
 * IIFE：避免 content_scripts 共享作用域顶层 function 名冲突（元规则 60 / ADR-0077）。
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
const PageAdvisorRegion = (() => {
  const MIN_REGION_PX = 20;

  /**
   * @param {{ x1:number, y1:number, x2:number, y2:number }} corners
   * @returns {{ left:number, top:number, width:number, height:number }}
   */
  function normalizeRect(corners) {
    const x1 = Number(corners?.x1) || 0;
    const y1 = Number(corners?.y1) || 0;
    const x2 = Number(corners?.x2) || 0;
    const y2 = Number(corners?.y2) || 0;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return { left, top, width, height };
  }

  /**
   * @param {{ left:number, top:number, width:number, height:number }|null|undefined} region
   * @param {number} [minPx]
   * @returns {boolean}
   */
  function isValidRegion(region, minPx = MIN_REGION_PX) {
    if (!region) return false;
    const min = Math.max(1, Number(minPx) || MIN_REGION_PX);
    return Number(region.width) >= min && Number(region.height) >= min;
  }

  /**
   * @param {{ left:number, top:number, width:number, height:number }} a
   * @param {{ left:number, top:number, width:number, height:number }} b
   * @returns {boolean}
   */
  function rectsIntersect(a, b) {
    if (!a || !b) return false;
    const aRight = a.left + a.width;
    const aBottom = a.top + a.height;
    const bRight = b.left + b.width;
    const bBottom = b.top + b.height;
    return a.left < bRight && aRight > b.left && a.top < bBottom && aBottom > b.top;
  }

  return {
    MIN_REGION_PX,
    normalizeRect,
    isValidRegion,
    rectsIntersect,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorRegion;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorRegion = PageAdvisorRegion;
}
}
