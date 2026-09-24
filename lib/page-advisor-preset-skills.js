/**
 * 预埋 Prompt Skill：仅自动创新一条（只读，默认选中）。
 * 类别仍保留，供用户自行新建；不再预埋无障碍/转化/性能/SEO 四条。
 */
'use strict';

const PageAdvisorPresetSkills = (() => {
  const TENDENCIES = ['a11y', 'conversion', 'perf', 'seo', 'custom'];
  const BUNDLED_TENDENCIES = ['custom'];
  const RETIRED_BUNDLED_IDS = Object.freeze([
    'sys_tendency_a11y',
    'sys_tendency_conversion',
    'sys_tendency_perf',
    'sys_tendency_seo',
  ]);
  const PRESET_CATEGORY_DEFAULTS = Object.freeze({
    custom: Object.freeze({
      id: "sys_default_auto_innovate",
      title: "系统默认自动创新",
      tendency: "custom",
      body: "你是资深网页产品+UIUX创新设计师兼前端体验顾问。接下来我会提供一段网页局部区域（文字描述/截图/HTML代码），请针对该区域做创新优化，遵循下面全部规则：\n\n【目标】\n不只是美化，在保留原有业务功能、核心信息不变的前提下，做差异化、有记忆点、高可用的创新改版；兼顾视觉吸引力、信息可读性、交互愉悦感、转化引导、移动端适配、加载性能。\n\n【分析维度，逐条输出】\n1. 现状诊断：列出当前区域存在的问题（信息层级混乱、视觉重心缺失、交互平淡、移动端拥挤、引导弱、冗余元素、动画生硬等）\n2. 创新方向（至少3条差异化思路，一条保守优化、一条中度创新、一条大胆先锋方案，分别说明适用场景）\n3. 视觉创新：配色、排版、留白、形状、材质、阴影、层次，避免烂大街模板风格，给出明确风格关键词\n4. 交互微创新：hover、点击、滚动进入视口、拖拽、微动效、状态反馈，动画克制，不花哨，不影响性能；区分PC端/移动端不同交互逻辑\n5. 信息架构重构：文字精简、模块分组、优先级排序、图标使用、分割逻辑\n6. 转化/体验细节：CTA按钮、提示文案、错误态、空状态、加载态、反馈提示\n7. 可落地约束：\n   - 不引入重型第三方组件，优先CSS原生+轻量JS实现\n   - 保证可访问性：对比度达标、语义标签、键盘可操作\n   - 输出优先级：先给最终推荐方案，再给出【改动清单】，最后给出伪代码/HTML+CSS片段示例\n8. 禁止：过度动画、刺眼配色、遮挡核心内容、破坏原有业务逻辑、牺牲加载速度\n\n【输出格式】\n> 现状诊断\n> 三套创新方案（保守｜中度｜先锋）\n> ✅推荐方案详情（视觉+交互+文案+布局）\n> 改动清单（逐条，方便前端实现）\n> 参考实现代码片段\n> 风险提醒：兼容性、性能、移动端坑点\n\n现在开始分析下面的网页区域：",
    }),
  });

  function bundledPresetSkills() {
    return BUNDLED_TENDENCIES.map((t) => {
      const p = PRESET_CATEGORY_DEFAULTS[t];
      return {
        id: p.id,
        title: p.title,
        tendency: p.tendency,
        body: p.body,
        is_default: true,
        readonly: true,
      };
    });
  }

  function bundledPresetIds() {
    return BUNDLED_TENDENCIES.map((t) => PRESET_CATEGORY_DEFAULTS[t].id);
  }

  function retiredBundledIds() {
    return RETIRED_BUNDLED_IDS.slice();
  }

  function normalizeTendencyKey(raw) {
    const t = String(raw || '').trim();
    return t || 'custom';
  }

  function catalogRowForPreset(catalogSkills, preset) {
    const list = Array.isArray(catalogSkills) ? catalogSkills : [];
    const id = String(preset?.id || '').trim();
    const byId = list.find((s) => String(s?.id || '').trim() === id);
    if (byId) return byId;
    return preset;
  }

  function groupSkillsByTendency(skills, { includeEmptyPresets = false } = {}) {
    const list = Array.isArray(skills) ? skills : [];
    const buckets = new Map();
    TENDENCIES.forEach((t) => buckets.set(t, []));
    const extraOrder = [];
    list.forEach((s) => {
      const t = normalizeTendencyKey(s?.tendency);
      if (buckets.has(t)) {
        buckets.get(t).push(s);
        return;
      }
      if (!buckets.has(t)) {
        buckets.set(t, []);
        extraOrder.push(t);
      }
      buckets.get(t).push(s);
    });
    const groups = [];
    TENDENCIES.forEach((tendency) => {
      const items = buckets.get(tendency) || [];
      if (items.length || includeEmptyPresets) {
        groups.push({ tendency, skills: items });
      }
    });
    extraOrder.forEach((tendency) => {
      groups.push({ tendency, skills: buckets.get(tendency) || [] });
    });
    return groups;
  }

  return {
    TENDENCIES,
    PRESET_CATEGORY_DEFAULTS,
    bundledPresetSkills,
    bundledPresetIds,
    retiredBundledIds,
    catalogRowForPreset,
    groupSkillsByTendency,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorPresetSkills;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorPresetSkills = PageAdvisorPresetSkills;
}
