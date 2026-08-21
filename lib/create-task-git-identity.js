/**
 * 创建任务：勾选自动运行时须为每个关联仓选择 Git 提交身份。
 * 纯函数，无 Chrome API 依赖；与 taskFE createTaskGitIdentityGate.js 对齐。
 */

(function initCreateTaskGitIdentity(global) {
  'use strict';

  function escapeAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function shouldRequire(autoRun) {
    return autoRun === true;
  }

  function gitIdentitiesRequestPath(userId, companyId) {
    const uid = String(userId || '').trim();
    let path = `/api/git-identities/user/${encodeURIComponent(uid)}/`;
    const cid = String(companyId || '').trim();
    if (cid) path += `?company_id=${encodeURIComponent(cid)}`;
    return path;
  }

  function settingsHref(companyId) {
    const cid = String(companyId || '').trim();
    if (!cid) return '/profile/git-identities/';
    return `/tenant/${encodeURIComponent(cid)}/profile/git-identities/`;
  }

  function formatLabel(identity) {
    const name = String(identity?.git_user_name || identity?.name || '').trim();
    const email = String(identity?.git_user_email || identity?.email || '').trim();
    if (name && email) return `${name} <${email}>`;
    return name || email || String(identity?.id || '');
  }

  function defaultIdentityId(identities) {
    const rows = Array.isArray(identities) ? identities : [];
    const def = rows.find((row) => row && row.is_default);
    return String(def?.id || '').trim();
  }

  function normalizeSelections(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const row of raw) {
      const repoUrl = String(row?.repo_url || '').trim();
      const gitIdentityId = String(row?.git_identity_id || '').trim();
      if (!repoUrl || seen.has(repoUrl)) continue;
      seen.add(repoUrl);
      out.push({ repo_url: repoUrl, git_identity_id: gitIdentityId });
    }
    return out;
  }

  function collectRepoUrls(projectIds, projectsList) {
    const ids = Array.isArray(projectIds) ? projectIds.map(String).filter(Boolean) : [];
    const list = Array.isArray(projectsList) ? projectsList : [];
    const urls = [];
    const seen = new Set();
    for (const projectId of ids) {
      const proj = list.find((p) => String(p.id || p._id) === projectId);
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos : [];
      for (const raw of repos) {
        const url = String(raw || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
    return urls;
  }

  function validate(autoRun, selections, requiredRepoUrls) {
    if (!shouldRequire(autoRun)) return '';
    const required = Array.isArray(requiredRepoUrls)
      ? requiredRepoUrls.map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    if (!required.length) return '';
    const byUrl = new Map();
    normalizeSelections(selections).forEach((row) => {
      byUrl.set(row.repo_url, row);
    });
    for (const url of required) {
      const row = byUrl.get(url);
      if (!row || !row.git_identity_id) {
        return `请为仓库选择 Git 提交身份：${url}`;
      }
    }
    return '';
  }

  function validateFromForm(form = {}) {
    const urls = collectRepoUrls(form.projectIds, form.projectsList);
    return validate(form.auto_run === true, form.repo_identities, urls);
  }

  function buildPayload(autoRun, selections) {
    if (!shouldRequire(autoRun)) return undefined;
    return normalizeSelections(selections).filter((row) => row.git_identity_id);
  }

  function buildPayloadFromForm(form = {}) {
    return buildPayload(form.auto_run === true, form.repo_identities);
  }

  function buildSelectHtml({
    repoUrl = '',
    identities = [],
    previousByUrl = {},
    settingsHref: href = '',
  } = {}) {
    const url = String(repoUrl || '').trim();
    if (!url) return '';
    const selected = String(previousByUrl[url] || '').trim() || defaultIdentityId(identities);
    let html = '<div class="repo-git-identity" style="margin:4px 0 0">';
    html += '<label style="display:block;font-size:10px;color:#a6adc8;margin-bottom:2px">Git 提交身份</label>';
    html += `<select data-git-identity="1" data-repo-url="${escapeAttr(url)}"`;
    html += ' data-testid="create-task-repo-git-identity-select"';
    html += ' style="width:100%;font-size:11px">';
    html += '<option value="">请选择用于该仓库提交的身份</option>';
    const rows = Array.isArray(identities) ? identities : [];
    for (const identity of rows) {
      const iid = String(identity?.id || '').trim();
      if (!iid) continue;
      const sel = iid === selected ? ' selected' : '';
      html += `<option value="${escapeAttr(iid)}"${sel}>${escapeAttr(formatLabel(identity))}</option>`;
    }
    html += '</select>';
    if (href) {
      html += `<a href="${escapeAttr(href)}" data-git-identity-settings="1"`;
      html += ' style="display:inline-block;font-size:10px;margin-top:2px">去账号中心管理 Git 提交身份</a>';
    }
    html += '</div>';
    return html;
  }

  function buildEditorsHtml({
    projectIds = [],
    projectsList = [],
    identities = [],
    previousByUrl = {},
    settingsHref: href = '',
    enabled = false,
  } = {}) {
    if (!enabled) return '';
    const urls = collectRepoUrls(projectIds, projectsList);
    if (!urls.length) return '';
    let html = '<div data-testid="create-task-git-identity-section">';
    for (const url of urls) {
      html += `<p style="font-size:10px;color:#a6adc8;word-break:break-all;margin:6px 0 2px">${escapeAttr(url)}</p>`;
      html += buildSelectHtml({
        repoUrl: url,
        identities,
        previousByUrl,
        settingsHref: href,
      });
    }
    html += '</div>';
    return html;
  }

  function readSelectionsMap(root) {
    const map = {};
    if (!root || typeof root.querySelectorAll !== 'function') return map;
    root.querySelectorAll('[data-git-identity][data-repo-url]').forEach((el) => {
      const url = String(el.getAttribute('data-repo-url') || '').trim();
      if (!url) return;
      map[url] = String(el.value || '').trim();
    });
    return map;
  }

  function readRepoIdentitiesFromRoot(root) {
    return Object.entries(readSelectionsMap(root)).map(([repo_url, git_identity_id]) => ({
      repo_url,
      git_identity_id,
    }));
  }

  function unwrapIdentities(data) {
    if (Array.isArray(data?.identities)) return data.identities;
    if (Array.isArray(data)) return data;
    return [];
  }

  const CreateTaskGitIdentity = {
    shouldRequire,
    gitIdentitiesRequestPath,
    settingsHref,
    formatLabel,
    defaultIdentityId,
    normalizeSelections,
    collectRepoUrls,
    validate,
    validateFromForm,
    buildPayload,
    buildPayloadFromForm,
    buildSelectHtml,
    buildEditorsHtml,
    readSelectionsMap,
    readRepoIdentitiesFromRoot,
    unwrapIdentities,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CreateTaskGitIdentity;
  }
  if (global) {
    global.CreateTaskGitIdentity = CreateTaskGitIdentity;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
