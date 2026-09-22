/** Popup Skill：工作空间 PUT/冲突与本机 persist。 */
(function (global) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  function collectPushWorkspaceIds(store, cloudRevisions, syncLocal, legacyWorkspaceId) {
    const ids = new Set(Object.keys(cloudRevisions || {}));
    const legacy = String(legacyWorkspaceId || '').trim();
    (store?.skills || []).forEach((s) => {
      const t = String(s.syncTarget || '').trim();
      if (t && t !== syncLocal) ids.add(t);
      else if (!t && legacy) ids.add(legacy);
    });
    return [...ids];
  }

  function renderConflict(pendingConflict) {
    const box = $('#popupSkillConflict');
    if (!box) return;
    box.style.display = pendingConflict ? 'block' : 'none';
  }

  async function pushWorkspaces(ctx) {
    if (typeof PageAdvisorAPI === 'undefined' || typeof PageAdvisorAPI.putPromptSkills !== 'function') {
      return { ok: true, localOnly: true };
    }
    await ctx.refreshWorkspaceRows();
    const store = ctx.getStore();
    const legacyWorkspaceId = String(ctx.scope?.workspaceId || '').trim();
    const fallbackTenant = String(ctx.scope?.tenantId || '').trim();
    const wids = collectPushWorkspaceIds(
      store, ctx.cloudRevisions, ctx.syncLocalValue(), legacyWorkspaceId,
    );
    if (!wids.length) return { ok: true, localOnly: true };
    let ok = true;
    for (const wid of wids) {
      const tenantId = ctx.tenantForWorkspace(wid)
        || (wid === legacyWorkspaceId ? fallbackTenant : '');
      if (!tenantId) {
        ctx.statusText(tx('paSkillNeedWorkspace'));
        ok = false;
        continue;
      }
      try {
        const remote = await PageAdvisorAPI.getPromptSkills(tenantId, wid);
        const gotRev = String(remote?.revision || '').trim();
        const lww = ctx.lwwWorkspaceIds.delete(wid);
        if (!lww && gotRev && !ctx.cloudRevisions[wid]) ctx.cloudRevisions[wid] = gotRev;
        const putStore = PageAdvisorPromptSkills.buildWorkspacePutStore(
          store, remote, wid, legacyWorkspaceId,
        );
        const saved = await PageAdvisorAPI.putPromptSkills(
          tenantId, wid,
          PageAdvisorPromptSkills.toApiPayload(putStore, lww ? '' : (ctx.cloudRevisions[wid] || '')),
          ctx.newIdempotencyKey(),
        );
        const rec = PageAdvisorPromptSkills.mergeWorkspaceBundle(store, saved, wid, legacyWorkspaceId);
        ctx.setStore(rec.store);
        const rev = String(saved?.revision || '').trim();
        if (rev) ctx.cloudRevisions[wid] = rev;
      } catch (e) {
        if (e?.status === 409) {
          ctx.setPendingConflict(e?.body?.current || { skills: [], active_skill_id: '' }, wid);
          renderConflict(true);
          ctx.statusText(tx('paSkillConflictTitle'));
          return { ok: false, conflict: true };
        }
        ctx.statusCloudFail(e);
        ok = false;
      }
    }
    return { ok };
  }

  async function persist(ctx) {
    await PageAdvisorPromptSkills.saveToStorage(ctx.getStore(), ctx.storage());
    if (!ctx.pluginLoggedIn()) return true;
    const before = JSON.stringify(ctx.getStore());
    const scope = await ctx.resolveSkillScope();
    try {
      const pushed = await pushWorkspaces({ ...ctx, scope });
      if (pushed.conflict) return false;
      if (pushed.ok) {
        ctx.setPendingConflict(null, '');
        renderConflict(false);
      }
      if (JSON.stringify(ctx.getStore()) !== before) {
        await PageAdvisorPromptSkills.saveToStorage(ctx.getStore(), ctx.storage());
      }
      return pushed.ok;
    } catch (e) {
      ctx.statusCloudFail(e);
      return false;
    }
  }

  async function resolveConflictKeepLocal(ctx) {
    if (ctx.saveBusy()) return;
    ctx.setSaveBusy(true);
    try {
      const wid = ctx.pendingConflictWorkspaceId();
      if (wid) ctx.lwwWorkspaceIds.add(wid);
      ctx.setPendingConflict(null, '');
      renderConflict(false);
      const ok = await persist(ctx);
      if (ok) {
        ctx.renderList();
        ctx.statusText(tx('paSkillSaved'));
      }
    } catch (e) {
      ctx.statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      ctx.setSaveBusy(false);
    }
  }

  async function resolveConflictUseCloud(ctx) {
    if (ctx.saveBusy()) return;
    ctx.setSaveBusy(true);
    try {
      const remote = ctx.pendingConflict() || { skills: [], active_skill_id: '' };
      const wid = ctx.pendingConflictWorkspaceId();
      const scope = await ctx.resolveSkillScope();
      ctx.setStore(PageAdvisorPromptSkills.mergeWorkspaceBundle(
        ctx.getStore(), remote, wid, scope?.workspaceId || '',
      ).store);
      ctx.cloudRevisions[wid] = String(remote?.revision || '').trim();
      ctx.setPendingConflict(null, '');
      renderConflict(false);
      await PageAdvisorPromptSkills.saveToStorage(ctx.getStore(), ctx.storage());
      ctx.renderList();
      ctx.setEditorVisible(false);
      ctx.statusText(tx('paSkillSyncedPull'));
    } catch (e) {
      ctx.statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      ctx.setSaveBusy(false);
    }
  }

  global.PopupPromptSkillCloud = {
    collectPushWorkspaceIds,
    pushWorkspaces,
    persist,
    renderConflict,
    resolveConflictKeepLocal,
    resolveConflictUseCloud,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
