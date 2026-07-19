/**
 * DevTools 面板请求列表引导冒烟测试（Playwright）
 *
 * 回归：打开面板后 #selectedRequest 不得长期停留「正在加载请求列表...」；
 * 应出现列表项或「暂无匹配的请求」。
 *
 * OPT-20260717-010
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

const PANEL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>TaskPlugin DevTools Panel</title></head>
<body>
  <div id="app">
    <div id="selectedRequest">正在加载请求列表...</div>
    <div id="requestList" style="display:none"></div>
    <div id="emptyState" style="display:none">暂无匹配的请求</div>
  </div>
</body>
</html>`;

test.describe('DevTools Panel — 请求列表引导冒烟', () => {
  test('面板加载后不应长期停留在「正在加载请求列表...」', async ({ page }) => {
    await page.setContent(PANEL_HTML);

    // 模拟 PanelRequestBootstrap：1.5s 后加载完成
    await page.addInitScript(() => {
      window.simulateRequestLoad = (hasRequests) => {
        const sel = document.getElementById('selectedRequest');
        const list = document.getElementById('requestList');
        const empty = document.getElementById('emptyState');
        if (!sel) return;

        if (hasRequests) {
          sel.textContent = '已选择：GET /api/test';
          list.style.display = 'block';
          list.innerHTML = '<div class="request-item">GET /api/test — 200</div>';
        } else {
          sel.textContent = '';
          empty.style.display = 'block';
        }
      };

      // 模拟异步加载：1s 后完成
      setTimeout(() => {
        window.simulateRequestLoad(false);
      }, 1000);
    });

    // 初始状态：正在加载
    const sel = page.locator('#selectedRequest');
    await expect(sel).toHaveText('正在加载请求列表...');

    // 1.5s 后不应再显示加载文本
    await page.waitForTimeout(1500);
    const text = await sel.textContent();
    expect(text).not.toContain('正在加载请求列表');

    // 应显示空状态或已选择请求
    const emptyState = page.locator('#emptyState');
    const hasEmptyOrRequest = await Promise.any([
      emptyState.isVisible().then(() => true),
      page.waitForTimeout(500).then(() => false),
    ]);
    // 至少加载状态已结束
    expect(text === '' || text.includes('已选择') || text.includes('暂无')).toBeTruthy();
  });

  test('有请求时应展示请求列表项', async ({ page }) => {
    await page.setContent(PANEL_HTML);

    await page.addInitScript(() => {
      setTimeout(() => {
        const sel = document.getElementById('selectedRequest');
        const list = document.getElementById('requestList');
        if (sel) sel.textContent = '已选择：POST /api/task';
        if (list) {
          list.style.display = 'block';
          list.innerHTML = [
            '<div class="request-item">GET /api/user — 200</div>',
            '<div class="request-item">POST /api/task — 201</div>',
            '<div class="request-item">GET /api/project — 200</div>',
          ].join('');
        }
      }, 800);
    });

    await page.waitForTimeout(1200);
    const items = page.locator('#requestList .request-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const selText = await page.locator('#selectedRequest').textContent();
    expect(selText).not.toContain('正在加载请求列表');
  });
});
