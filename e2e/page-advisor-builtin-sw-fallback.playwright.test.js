/**
 * 真实扩展 SW：mock LanguageModel 时 zh 回退 en、异步计量裁剪后能产出建议。
 *
 * 运行：bash e2e/page-advisor-builtin-sw-fallback.playwright.test.js.sh
 */
const path = require('path');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();
const { launchExtensionContext } = require('./helpers/launchExtensionContext');

const ROOT = path.resolve(__dirname, '..');
const T = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('真实扩展 SW 内置模型回退', () => {
  test('zh unavailable 时 create 使用 en，超配额正文被裁短且解析出建议', async () => {
    test.setTimeout(120_000);
    const { chromium } = loadPlaywrightTest();
    const context = await launchExtensionContext(chromium, ROOT, { headless: false });
    try {
      let sw = null;
      for (let i = 0; i < 20 && !sw; i += 1) {
        sw = context.serviceWorkers()[0] || null;
        if (!sw) await T(500);
      }
      expect(sw, '扩展 Service Worker 应启动').toBeTruthy();

      const out = await sw.evaluate(async () => {
        const seenLang = [];
        const session = {
          inputQuota: 9216,
          async measureInputUsage(text) {
            return Promise.resolve(String(text || '').length);
          },
          async prompt(text) {
            return { output: JSON.stringify([{ id: 's1', title: '短', summary: '摘要' }]), promptChars: String(text || '').length };
          },
          destroy() {},
        };
        globalThis.LanguageModel = {
          async availability(options) {
            const lang = options
              && options.expectedInputs
              && options.expectedInputs[0]
              && options.expectedInputs[0].languages
              && options.expectedInputs[0].languages[0];
            seenLang.push(lang || '');
            if (lang === 'zh' || lang === 'zh-CN') return 'unavailable';
            return 'available';
          },
          async create(options) {
            seenLang.push((options && options.expectedInputs && options.expectedInputs[0]
              && options.expectedInputs[0].languages && options.expectedInputs[0].languages[0]) || '');
            return session;
          },
        };
        const result = await PageAdvisorBuiltinPrompt.suggest(globalThis.LanguageModel, {
          url: 'https://example.test/builtin',
          title: '页',
          pageText: '字'.repeat(20000),
          domOutline: [{ nid: 'n1', tag: 'button', text: '提交' }],
        }, {
          locale: 'zh-CN',
          skill: { title: 's', body: `KEEP_${'x'.repeat(8000)}` },
        });
        return {
          count: result.suggestions.length,
          skippedSkill: result.skippedSkill,
          seenLang,
          hasApi: typeof PageAdvisorBuiltinPrompt.suggest === 'function',
        };
      });

      expect(out.hasApi).toBe(true);
      expect(out.count).toBe(1);
      expect(out.skippedSkill).toBe(true);
      expect(out.seenLang).toContain('zh');
      expect(out.seenLang.filter((x) => x === 'en').length).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
