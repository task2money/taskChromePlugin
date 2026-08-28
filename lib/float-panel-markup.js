'use strict';

/**
 * 页内浮窗 DOM 模板。从 content.js 抽出以遵守行数门禁，并承载「加入自动调度队列」勾选。
 */
function floatPanelMarkupHtml() {
  return `
    <button id="taskplugin-float-btn" title="云端Coding: 自动创新助手 — 快速创建任务">+</button>
    <div id="taskplugin-float-panel">
      <div class="taskplugin-panel-header">
        <h3>🔧 快速创建任务</h3>
        <div style="display:flex;align-items:center;gap:6px">
          <span id="taskplugin-login-badge" class="taskplugin-badge taskplugin-badge-err">未登录</span>
          <button id="taskplugin-float-close" type="button" class="taskplugin-float-close" aria-label="关闭浮窗" title="关闭浮窗">×</button>
        </div>
      </div>
      <div class="taskplugin-panel-body">
        <div id="taskplugin-user-guide" class="taskplugin-user-guide-host"></div>
        <div class="taskplugin-captured-url" id="taskplugin-page-url"></div>
        <div id="taskplugin-aidev-status" class="taskplugin-aidev-status" hidden></div>
        <div class="taskplugin-form-group">
          <label>工作空间</label>
          <select class="taskplugin-select" id="taskplugin-workspace">
            <option value="">-- 请先登录 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>项目 (单选)</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-projects">
            <span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>标题</label>
          <input class="taskplugin-input" id="taskplugin-title" placeholder="任务标题">
        </div>
        <div class="taskplugin-form-group">
          <div class="taskplugin-label-row">
            <span>描述</span>
            <span class="taskplugin-label-actions">
              <button type="button" class="taskplugin-btn taskplugin-btn-reset" id="taskplugin-desc-reset" title="清空任务描述" disabled>重置</button>
            </span>
          </div>
          <textarea class="taskplugin-textarea" id="taskplugin-desc" placeholder="任务描述...（按快捷键指针选择页面元素）"></textarea>
        </div>
        <div class="taskplugin-form-group">
          <label>优先级</label>
          <select class="taskplugin-select" id="taskplugin-priority">
            <option value="0">高</option>
            <option value="1" selected>中</option>
            <option value="2">低</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>进度状态</label>
          <select class="taskplugin-select" id="taskplugin-progress">
            <option value="">-- 请先选择工作空间 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>交付物类别</label>
          <select class="taskplugin-select" id="taskplugin-deliverable">
            <option value="">-- 请先选择工作空间 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>已安装镜像 <span id="taskplugin-image-required" hidden style="color:#f38ba8;font-size:10px;">*自动运行必选</span></label>
          <select class="taskplugin-select" id="taskplugin-image">
            <option value="">无</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>智能体资源配置 <span style="color:#f38ba8;font-size:10px;">*必填</span></label>
          <select class="taskplugin-select" id="taskplugin-feature-params">
            <option value="">-- 请选择 --</option>
            <option value="company">公司默认</option>
            <option value="workspace">工作空间默认</option>
            <option value="personal">个人配置</option>
          </select>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-personal-wrap" style="display:none">
          <label>个人配置</label>
          <select class="taskplugin-select" id="taskplugin-personal-config">
            <option value="">-- 请选择个人配置 --</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>截止日期</label>
          <input class="taskplugin-input" type="datetime-local" id="taskplugin-due-date">
        </div>
        <div class="taskplugin-form-group">
          <label class="taskplugin-toggle-label" for="taskplugin-auto-run">
            <input type="checkbox" id="taskplugin-auto-run" disabled aria-disabled="true">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title">是否自动运行</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-auto-run-hint">请先选择项目</span>
            </span>
          </label>
        </div>
        <div class="taskplugin-form-group taskplugin-queued-auto-run-wrap" id="taskplugin-queued-auto-run-wrap" hidden>
          <label class="taskplugin-toggle-label" for="taskplugin-queued-auto-run">
            <input type="checkbox" id="taskplugin-queued-auto-run">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title">加入自动调度队列</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-queued-auto-run-hint">工作空间已启用自动调度。勾选后任务进入排队，按调度时段逐个启动，创建后不立即启服。不勾选则仍立即按运行模版启动。</span>
            </span>
          </label>
          <div id="taskplugin-queued-auto-run-error" class="taskplugin-result" hidden></div>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-git-identities"></div>
        <div class="taskplugin-form-group">
          <label>基准分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 空则用项目默认分支</span></label>
          <div id="taskplugin-repo-bases" class="taskplugin-checkbox-list">
            <span style="color:#6c7086;font-size:11px;">空则用项目默认分支</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>协作人员 (可多选)</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-assignees">
            <span style="color:#6c7086;font-size:11px;">选择工作空间后加载</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label>工作分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 模板 / 仓库分支 / 可手写</span></label>
          <input class="taskplugin-input" id="taskplugin-work-branch" placeholder="选择或输入工作分支" list="taskplugin-work-branch-list">
          <datalist id="taskplugin-work-branch-list"></datalist>
        </div>
        <div class="taskplugin-form-group">
          <label>合并目标分支 <span style="color:#6c7086;font-size:10px;font-weight:normal;">— 模板 / 仓库分支 / 可手写</span></label>
          <input class="taskplugin-input" id="taskplugin-merge-target" placeholder="选择或输入合并目标分支" list="taskplugin-merge-list">
          <datalist id="taskplugin-merge-list"></datalist>
        </div>
        <button class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-submit">✅ 创建任务</button>
        <div id="taskplugin-result" class="taskplugin-result"></div>
      </div>
    </div>
    <div id="taskplugin-adjust-modal" class="taskplugin-modal" hidden>
      <div class="taskplugin-modal-card" role="dialog" aria-modal="true" aria-labelledby="taskplugin-adjust-title">
        <h4 id="taskplugin-adjust-title">希望对这个元素做什么调整？</h4>
        <p class="taskplugin-modal-el" id="taskplugin-adjust-el-summary"></p>
        <textarea id="taskplugin-adjust-input" class="taskplugin-textarea" rows="4" placeholder="例如：把按钮改成红色、增大字号、调整间距..."></textarea>
        <label class="taskplugin-shot-label">
          <input type="checkbox" id="taskplugin-adjust-shot">
          <span>附带元素截图（上传后写入 URL，不内嵌 data URL）</span>
        </label>
        <div class="taskplugin-modal-actions">
          <button type="button" class="taskplugin-btn" id="taskplugin-adjust-cancel">取消</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-btn-modal-primary" id="taskplugin-adjust-confirm">确认加入描述</button>
        </div>
        <div id="taskplugin-adjust-error" class="taskplugin-result"></div>
      </div>
    </div>
`;
}

const FloatPanelMarkup = { html: floatPanelMarkupHtml };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatPanelMarkup;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatPanelMarkup = FloatPanelMarkup;
}
