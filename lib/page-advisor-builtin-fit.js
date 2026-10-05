/**
 * 本机 Prompt API 上下文裁剪。measureInputUsage / measureContextUsage 均为 Promise。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinFit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinFitFactory() {
  function isInteractive(node) {
    const tag = String(node && node.tag || '').toLowerCase();
    const role = String(node && node.role || '').toLowerCase();
    return tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select'
      || role === 'button' || role === 'link' || role === 'textbox';
  }

  function lastNonInteractive(outline) {
    for (let i = outline.length - 1; i >= 0; i -= 1) {
      if (!isInteractive(outline[i])) return i;
    }
    return -1;
  }

  function joinedPrompt(page, skill, locale) {
    if (typeof PageAdvisorLLM !== 'undefined' && typeof PageAdvisorLLM.buildChatMessages === 'function') {
      return PageAdvisorLLM.buildChatMessages(page, skill || null, locale).map((m) => m.content).join('\n');
    }
    return [page && page.pageText, skill && (skill.body || skill)].filter(Boolean).join('\n');
  }

  // OPT-20261005-002: 第二参为上下文占比（按硬件档位传入），默认 0.65。
  function inputBudget(quota, factor) {
    const q = Number(quota);
    if (!Number.isFinite(q) || q <= 0) return Infinity;
    const f = Number(factor);
    const ratio = Number.isFinite(f) && f > 0 && f <= 1 ? f : 0.65;
    return Math.max(256, Math.floor(q * ratio));
  }

  async function resolveUsage(value) {
    const raw = (value && typeof value.then === 'function') ? await value : value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function sessionMeasureFn(session) {
    if (!session) return null;
    if (typeof session.measureContextUsage === 'function') {
      return (text) => session.measureContextUsage(text);
    }
    if (typeof session.measureInputUsage === 'function') {
      return (text) => session.measureInputUsage(text);
    }
    return (text) => String(text || '').length;
  }

  async function shrinkPage(page, measure, quota) {
    const source = page || {};
    let text = String(source.pageText || '');
    let outline = Array.isArray(source.domOutline) ? source.domOutline.slice() : [];
    const next = () => ({ ...source, pageText: text, domOutline: outline });
    let guard = 0;
    while (await resolveUsage(measure(next())) > quota && guard < 64) {
      guard += 1;
      const chars = Array.from(text);
      if (chars.length > 400) {
        text = chars.slice(0, Math.floor(chars.length / 2)).join('');
        continue;
      }
      const drop = lastNonInteractive(outline);
      if (drop >= 0) {
        outline = outline.filter((_, i) => i !== drop);
        continue;
      }
      if (chars.length > 0) {
        text = chars.slice(0, Math.floor(chars.length / 2)).join('');
        continue;
      }
      break;
    }
    const pageOut = next();
    return { page: pageOut, usage: await resolveUsage(measure(pageOut)) };
  }

  async function fitPrompt(page, skill, locale, measureText, quota) {
    const fitted = await shrinkPage(page, (p) => measureText(joinedPrompt(p, null, locale)), quota);
    const bare = joinedPrompt(fitted.page, null, locale);
    if (skill && await resolveUsage(measureText(joinedPrompt(fitted.page, skill, locale))) <= quota) {
      const prompt = joinedPrompt(fitted.page, skill, locale);
      return {
        page: fitted.page,
        prompt,
        skippedSkill: false,
        usage: await resolveUsage(measureText(prompt)),
      };
    }
    return {
      page: fitted.page,
      prompt: bare,
      skippedSkill: !!skill,
      usage: await resolveUsage(measureText(bare)),
    };
  }

  return {
    joinedPrompt,
    inputBudget,
    resolveUsage,
    sessionMeasureFn,
    shrinkPage,
    fitPrompt,
  };
});
