/**
 * Popup saved-skill browse copy. Separate file so i18n-messages.js is not grown.
 * Later registerMessages overrides paSkillSectionHint (category, then skill).
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    paSkillPickCategory: '先选择类别',
    paSkillBackToCategories: '返回类别',
    paSkillSectionHint: '点「设置」管理 Skill。已保存的 Skill 先选择类别（无障碍/转化/性能/SEO/自定义），再选择该类别里的技能。未登录也会预埋系统管理页平台目录那五条（只读，正文与目录页一致）。每条可只存本机，或同步到指定工作空间。工作空间 Skill 也可在 SaaS「工作空间管理」行「自动创新提示词管理」编辑。选中后仅在直连智能体时追加到系统提示（Alt+Z 整页与 Alt+Shift+Z 区域都走直连，云端回退不带 Skill）；API Key 仍只保存在本机。',
  };
  const en = {
    paSkillPickCategory: 'Choose a category first',
    paSkillBackToCategories: 'Back to categories',
    paSkillSectionHint: 'Click Settings to manage skills. Saved skills ask you to choose a category first (Accessibility / Conversion / Performance / SEO / Custom), then a skill in that category. The five platform-catalog prompts (same as system-admin prompt-skills) are preloaded while signed out (read-only). Each skill can stay on this device or sync to a chosen workspace. Workspace skills can also be edited under tenant Settings → workspace management → Auto-innovate prompt skills. The selected skill is appended only on direct agent calls — both Alt+Z (whole page) and Alt+Shift+Z (picked region) are direct, and cloud fallback ignores it. API keys stay on this device.',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
