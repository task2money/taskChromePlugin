/**
 * 平台五类预设 Prompt Skill（与 taskFE PRESET_CATEGORY_DEFAULTS / SQL 008 同文案）。
 * 供 Popup 未登录预埋与按类别分组。
 */
'use strict';

const PageAdvisorPresetSkills = (() => {
  const TENDENCIES = ['a11y', 'conversion', 'perf', 'seo', 'custom'];
  const PRESET_CATEGORY_DEFAULTS = Object.freeze({
    a11y: Object.freeze({
      id: 'sys_tendency_a11y',
      title: '系统默认·无障碍',
      tendency: 'a11y',
      body: '你优先从无障碍（WCAG）角度改进当前页面。关注：对比度与色弱可辨、表单 label 与错误提示、键盘可达与焦点顺序、图片 alt、标题层级、ARIA 名称与状态、运动敏感。每条建议必须可执行并尽量绑定真实 nid。不要把转化文案或 SEO 关键词当主目标。输出仍须遵守主系统提示的 JSON 格式。',
    }),
    conversion: Object.freeze({
      id: 'sys_tendency_conversion',
      title: '系统默认·转化',
      tendency: 'conversion',
      body: '你优先从转化与注册漏斗改进当前页面。关注：主 CTA 是否唯一且可见、价值主张是否一屏内说清、表单字段是否过长、信任背书、下一步预期、登录/付费门摩擦。建议必须可落地并尽量绑定真实 nid。不要把对比度或 meta 描述当主目标。输出仍须遵守主系统提示的 JSON 格式。',
    }),
    perf: Object.freeze({
      id: 'sys_tendency_perf',
      title: '系统默认·性能',
      tendency: 'perf',
      body: '你优先从网页性能改进当前页面。关注：LCP 元素、布局偏移 (CLS)、阻塞渲染的脚本与字体、过大图片与未设宽高、多余第三方、长任务。建议须可执行（压缩、懒加载、延后非关键脚本等）并尽量绑定真实 nid。不要把营销文案改写当主目标。输出仍须遵守主系统提示的 JSON 格式。',
    }),
    seo: Object.freeze({
      id: 'sys_tendency_seo',
      title: '系统默认·SEO',
      tendency: 'seo',
      body: '你优先从搜索引擎优化改进当前页面。关注：title 与 H1 唯一且含主题、meta description、语义标题层级、可抓取链接（真实 href）、图片文件名与 alt、避免空洞口号。建议须可执行并尽量绑定真实 nid。不要把按钮颜色或动画当主目标。输出仍须遵守主系统提示的 JSON 格式。',
    }),
    custom: Object.freeze({
      id: 'sys_default_auto_innovate',
      title: '系统默认自动创新',
      tendency: 'custom',
      body: '你是产品自动创新助手。根据当前页面与用户选中的区域，给出可落地的改进建议：问题、改法、预期收益。语气简洁，可执行。可覆盖体验、文案、结构与流程，不限定单一类别。输出仍须遵守主系统提示的 JSON 格式。',
    }),
  });

  function bundledPresetSkills() {
    return TENDENCIES.map((t) => {
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
    return TENDENCIES.map((t) => PRESET_CATEGORY_DEFAULTS[t].id);
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
