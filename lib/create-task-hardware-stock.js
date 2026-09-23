/**
 * 创建任务勾选自动运行时，按项目 server_run_template 查询 available-instances。
 * 无库存则阻断创建，并提示到项目详情页更换硬件。规格字段不足时不阻断。
 */
'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {

function stockInstanceType(template) {
  if (!template || typeof template !== 'object') return '';
  const selected = String(template.selected_instance || '').trim();
  if (selected) return selected;
  const hw = template.hardware_config;
  if (hw && typeof hw === 'object') return String(hw.instance_type || '').trim();
  return '';
}

function stockQueryTargetFromTemplate(template, project) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return null;
  const instanceType = stockInstanceType(template);
  const authorizationId = String(template.authorization_id || '').trim();
  const platformType = String(template.platform || template.platform_type || '').trim();
  const regionId = String(template.region || '').trim();
  let zoneId = String(template.zone_id || '').trim();
  if (zoneId.includes(':')) zoneId = zoneId.split(':')[0].trim();
  if (!instanceType || !authorizationId || !platformType || !regionId) return null;
  const name = String((project && (project.name || project.displayName || project.title)) || '').trim();
  const projectId = String((project && (project.id || project._id)) || '').trim();
  return {
    instanceType,
    authorizationId,
    platformType,
    regionId,
    zoneId,
    projectId,
    projectName: name || projectId || instanceType,
    key: [authorizationId, platformType, regionId, zoneId, instanceType].join('|'),
  };
}

function stockBillingParams(template) {
  const filter = template && template.filter_options && typeof template.filter_options === 'object'
    ? template.filter_options
    : {};
  const hw = template && template.hardware_config && typeof template.hardware_config === 'object'
    ? template.hardware_config
    : {};
  const spot = String(filter.spot_strategy || hw.spot_strategy || '').trim();
  const charge = String(
    filter.instance_charge_type || hw.instance_charge_type || (template && template.payment_type) || 'PostPaid',
  ).trim() || 'PostPaid';
  return {
    spotStrategy: spot || (charge === 'PostPaid' ? 'NoSpot' : ''),
    instanceChargeType: charge,
  };
}

function buildRunHardwareStockPath(target, tenantId, containerImageId, billing) {
  const params = new URLSearchParams();
  params.set('platform_type', target.platformType);
  params.set('region_id', target.regionId);
  if (target.zoneId) params.set('zone_id', target.zoneId);
  params.set('DestinationResource', 'InstanceType');
  params.set('ResourceType', 'instance');
  params.set('InstanceType', target.instanceType);
  const bill = billing || {};
  if (bill.instanceChargeType) params.set('InstanceChargeType', bill.instanceChargeType);
  if (bill.spotStrategy) params.set('spot_strategy', bill.spotStrategy);
  const imageId = String(containerImageId || '').trim();
  if (imageId) params.set('container_image_id', imageId);
  const auth = encodeURIComponent(target.authorizationId);
  const tenant = encodeURIComponent(String(tenantId || '').trim());
  return `/api/cloud/cloud-platform/${auth}/available-instances/tenant_id/${tenant}/?${params.toString()}`;
}

function listedInstanceTypeIds(data, instanceType) {
  const want = String(instanceType || '').trim();
  if (Array.isArray(data)) {
    return data
      .map((row) => String(row?.instance_type || row?.instance_type_id || row?.InstanceTypeId || '').trim())
      .filter(Boolean);
  }
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.instance_types)) {
    return data.instance_types
      .map((row) => {
        if (typeof row === 'string') return row.trim();
        return String(row?.instance_type || row?.InstanceTypeId || '').trim();
      })
      .filter(Boolean);
  }
  const nested = data.InstanceTypes?.InstanceType;
  if (!Array.isArray(nested)) return [];
  return nested
    .filter((row) => String(row?.Status || 'Available') === 'Available')
    .map((row) => String(row?.InstanceTypeId || row?.instance_type || '').trim())
    .filter((id) => id && (!want || id === want));
}

function interpretAvailableInstancesStock(data, instanceType) {
  const want = String(instanceType || '').trim();
  if (!want) return 'unknown';
  if (data && typeof data === 'object' && !Array.isArray(data) && data.status === 'error') {
    return 'error';
  }
  const ids = listedInstanceTypeIds(data, want);
  return ids.includes(want) ? 'in_stock' : 'out_of_stock';
}

function whereLabel(target) {
  return target.zoneId ? `${target.regionId} / ${target.zoneId}` : target.regionId;
}

function outOfStockMessage(target) {
  return tx('hardwareStockOut', {
    name: target.projectName,
    instanceType: target.instanceType,
    where: whereLabel(target),
  });
}

function selectedProjectIds(form) {
  if (Array.isArray(form.projectIds) && form.projectIds.length) {
    return form.projectIds.map((id) => String(id || '').trim()).filter(Boolean);
  }
  if (Array.isArray(form.projects)) {
    return form.projects
      .map((row) => String(row?.project_id || row?.projectId || row?.id || '').trim())
      .filter(Boolean);
  }
  return [];
}

function findProject(projectsList, id) {
  const want = String(id || '');
  if (!want || !Array.isArray(projectsList)) return null;
  return projectsList.find((p) => String(p?.id || p?._id || '') === want) || null;
}

function companyIdOf(project, form) {
  const fromForm = String(form?.companyId || form?.company_id || '').trim();
  if (fromForm) return fromForm;
  return String(project?.company || project?.company_id || project?.companyId || '').trim();
}

function hardwareStockContextFromForm(form) {
  if (!form || form.auto_run !== true) return null;
  const ids = selectedProjectIds(form);
  const list = form.projectsList || [];
  const targets = [];
  let companyId = String(form.companyId || form.company_id || '').trim();
  for (const id of ids) {
    const project = findProject(list, id);
    if (!project) continue;
    if (!companyId) companyId = companyIdOf(project, form);
    const target = stockQueryTargetFromTemplate(project.server_run_template, project);
    if (target) targets.push({ ...target, billing: stockBillingParams(project.server_run_template) });
  }
  if (!targets.length || !companyId) return null;
  return {
    companyId,
    containerImageId: String(form.container_image_id || form.containerImageId || '').trim(),
    targets,
  };
}

function payloadModule() {
  if (typeof CreateTaskPayload !== 'undefined') return CreateTaskPayload;
  if (typeof require === 'function') {
    try { return require('./create-task-payload.js'); } catch (_) { return null; }
  }
  return null;
}

function payloadWithStock(form) {
  const Payload = payloadModule();
  if (!Payload || typeof Payload.buildCreateTaskPayload !== 'function') {
    throw new Error('CreateTaskPayload missing');
  }
  const taskData = Payload.buildCreateTaskPayload(form || {});
  const ctx = hardwareStockContextFromForm(form || {});
  if (ctx) {
    if (!ctx.containerImageId) {
      ctx.containerImageId = String(taskData.container_image_id || '').trim();
    }
    taskData.hardwareStock = ctx;
  }
  return taskData;
}

function traceFrom(error, data) {
  const fromErr = error && error.traceId ? String(error.traceId).trim() : '';
  if (fromErr) return fromErr;
  if (data && typeof data === 'object') {
    return String(data.trace_id || data.traceId || '').trim();
  }
  return '';
}

function stockContextKey(ctx) {
  const targets = Array.isArray(ctx?.targets) ? ctx.targets : [];
  return [
    String(ctx?.companyId || ''),
    String(ctx?.containerImageId || ''),
    targets.map((t) => t.key).join(','),
  ].join('#');
}

async function assertHardwareInStock(ctx, request) {
  if (!ctx || typeof request !== 'function') return;
  const companyId = String(ctx.companyId || '').trim();
  const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
  if (!companyId || !targets.length) return;
  for (const target of targets) {
    const path = buildRunHardwareStockPath(
      target,
      companyId,
      ctx.containerImageId,
      target.billing,
    );
    let data;
    try {
      data = await request('GET', path);
    } catch (error) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'hardware_stock_gate',
        outcome: 'error',
        instance_type: target.instanceType,
        region_id: target.regionId,
      }));
      const err = new Error(tx('hardwareStockQueryFailed'));
      const tid = traceFrom(error);
      if (tid) err.traceId = tid;
      throw err;
    }
    const outcome = interpretAvailableInstancesStock(data, target.instanceType);
    if (outcome === 'in_stock') {
      console.info(JSON.stringify({
        level: 'info',
        event: 'hardware_stock_gate',
        outcome: 'in_stock',
        instance_type: target.instanceType,
        region_id: target.regionId,
      }));
      continue;
    }
    if (outcome === 'error') {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'hardware_stock_gate',
        outcome: 'error',
        instance_type: target.instanceType,
        region_id: target.regionId,
      }));
      const err = new Error(tx('hardwareStockQueryFailed'));
      const tid = traceFrom(null, data);
      if (tid) err.traceId = tid;
      throw err;
    }
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'hardware_stock_gate',
      outcome: 'out_of_stock',
      instance_type: target.instanceType,
      region_id: target.regionId,
    }));
    const err = new Error(outOfStockMessage(target));
    err.code = 'HARDWARE_OUT_OF_STOCK';
    throw err;
  }
}

async function taskDataWithoutHardwareStock(taskData, request) {
  const copy = { ...(taskData || {}) };
  const ctx = copy.hardwareStock;
  delete copy.hardwareStock;
  if (copy.auto_run === true && ctx) {
    await assertHardwareInStock(ctx, request);
  }
  return copy;
}

async function tasksDataWithoutHardwareStock(tasks, request) {
  const seen = new Set();
  const out = [];
  for (const task of tasks || []) {
    const copy = { ...(task || {}) };
    const ctx = copy.hardwareStock;
    delete copy.hardwareStock;
    if (copy.auto_run === true && ctx) {
      const key = stockContextKey(ctx);
      if (!seen.has(key)) {
        seen.add(key);
        await assertHardwareInStock(ctx, request);
      }
    }
    out.push(copy);
  }
  return out;
}

const CreateTaskHardwareStock = {
  stockQueryTargetFromTemplate,
  stockBillingParams,
  buildRunHardwareStockPath,
  interpretAvailableInstancesStock,
  hardwareStockContextFromForm,
  payloadWithStock,
  assertHardwareInStock,
  taskDataWithoutHardwareStock,
  tasksDataWithoutHardwareStock,
  outOfStockMessage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CreateTaskHardwareStock;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CreateTaskHardwareStock = CreateTaskHardwareStock;
}
}
