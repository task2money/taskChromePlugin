'use strict';

/**
 * OPT-20261005-002: 按硬件档位收敛本机模型预算，缩短推理时长。
 * 用 navigator.deviceMemory（GB，粗略）估算档位；低档减少建议条数并收紧上下文预算，
 * 让常见 CPU 机器把内置模型推理压到可接受范围内。
 * 纯函数，便于单测；档位未知时按中档处理（不激进也不放任）。
 */
const PageAdvisorHardwareTier = (() => {
  const TIER_BUDGETS = Object.freeze({
    low: Object.freeze({ maxItems: 3, budgetFactor: 0.5 }),
    mid: Object.freeze({ maxItems: 5, budgetFactor: 0.6 }),
    high: Object.freeze({ maxItems: 8, budgetFactor: 0.65 }),
  });

  const DEFAULT_TIER = 'mid';

  function normalizeTier(tier) {
    const t = String(tier || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TIER_BUDGETS, t) ? t : DEFAULT_TIER;
  }

  /**
   * 估算档位。deviceMemory 为设备内存近似值（GB），部分环境不提供。
   * 无信息时按中档；越低内存越保守。
   */
  function estimateTier(nav) {
    const mem = Number(nav && nav.deviceMemory);
    if (!Number.isFinite(mem) || mem <= 0) return DEFAULT_TIER;
    if (mem <= 4) return 'low';
    if (mem < 8) return 'mid';
    return 'high';
  }

  function budgetForTier(tier) {
    return TIER_BUDGETS[normalizeTier(tier)];
  }

  function tierLabelKey(tier) {
    switch (normalizeTier(tier)) {
      case 'low': return 'paBuiltinTierLow';
      case 'high': return 'paBuiltinTierHigh';
      default: return 'paBuiltinTierMid';
    }
  }

  /** 按档位克隆 schema 并覆盖 maxItems。 */
  function schemaForTier(tier, baseSchema) {
    const base = baseSchema && typeof baseSchema === 'object' ? baseSchema : {};
    return { ...base, maxItems: budgetForTier(tier).maxItems };
  }

  return {
    TIER_BUDGETS,
    DEFAULT_TIER,
    normalizeTier,
    estimateTier,
    budgetForTier,
    tierLabelKey,
    schemaForTier,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorHardwareTier;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorHardwareTier = PageAdvisorHardwareTier;
}
