/**
 * 指针多选修饰键：⌘/Ctrl 须在 pointerdown 读取。
 * Alt+X 之后 click 上的 ctrlKey/metaKey 常被剥掉，只听 click 会变成立刻单选。
 */

if (!globalThis.__taskpluginContentBoot?.skip) {
const PICK_CLICK_SUPPRESS_MS = 400;

function isPrimaryPickPointer(e) {
  if (!e) return false;
  const type = String(e.type || '');
  if (type === 'contextmenu') return true;
  if (typeof e.button === 'number' && e.button > 0) return false;
  return true;
}

function isAdditivePickModifier(e) {
  if (!e) return false;
  if (e.metaKey || e.ctrlKey) return true;
  if (typeof e.getModifierState === 'function') {
    try {
      return !!(
        e.getModifierState('Control')
        || e.getModifierState('Meta')
        || e.getModifierState('Accel')
      );
    } catch (_) {
      return false;
    }
  }
  return false;
}

/**
 * @returns {'ignore'|'toggle'|'finish'|'suppress'}
 */
function pickGestureKind(e, now, lastHandledAt, suppressWindowMs) {
  if (!e || !isPrimaryPickPointer(e)) return 'ignore';
  const type = String(e.type || '');
  const additive = isAdditivePickModifier(e);
  if (type === 'contextmenu') return additive ? 'toggle' : 'ignore';
  const windowMs = typeof suppressWindowMs === 'number' ? suppressWindowMs : PICK_CLICK_SUPPRESS_MS;
  const recentlyHandled = typeof lastHandledAt === 'number' && lastHandledAt > 0
    && typeof now === 'number'
    && (now - lastHandledAt) >= 0
    && (now - lastHandledAt) < windowMs;
  if (type === 'click' && recentlyHandled) return 'suppress';
  if (additive) return 'toggle';
  if (type === 'pointerdown' || type === 'mousedown' || type === 'click') return 'finish';
  return 'ignore';
}

const PickAdditiveModifier = {
  PICK_CLICK_SUPPRESS_MS,
  isPrimaryPickPointer,
  isAdditivePickModifier,
  pickGestureKind,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PickAdditiveModifier;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PickAdditiveModifier = PickAdditiveModifier;
  globalThis.PICK_CLICK_SUPPRESS_MS = PICK_CLICK_SUPPRESS_MS;
  globalThis.isPrimaryPickPointer = isPrimaryPickPointer;
  globalThis.isAdditivePickModifier = isAdditivePickModifier;
  globalThis.pickGestureKind = pickGestureKind;
  if (typeof ElementPicker === 'object' && ElementPicker) {
    ElementPicker.isAdditivePickModifier = isAdditivePickModifier;
    ElementPicker.pickGestureKind = pickGestureKind;
    ElementPicker.PICK_CLICK_SUPPRESS_MS = PICK_CLICK_SUPPRESS_MS;
  }
}
}
