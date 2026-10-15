/**
 * 直连 LLM 调用账本（OPT-20261015-022）。
 *
 * 背景：插件里的「直连我的 Key」路径（`lib/page-advisor-llm-client.js` 的 suggest、
 * `lib/page-advisor-llm-probe.js` 的连通性测试）把**页面正文 + 用户自填 Key** 同时
 * 发往第三方主机，而平台侧对这条链路完全不可见——工作区下发的代理令牌走网关时才有
 * `llm_call` 审计（taskAIEndPoint），用户自填 Key 的直连调用任何地方都没记录。于是
 * 「这些内容发去了哪个主机、用了多少 token」在争议时无法回答。
 *
 * 本模块在**用户本机**留一份可导出的账：环形缓冲写 chrome.storage.local（service
 * worker 与 popup 都能读，localStorage 在 SW 里不可用），只记事后可核对的元数据。
 *
 * 硬边界（安全）：条目字段是**白名单构造**的，不接受调用方直接塞对象——apiKey、请求
 * 正文、页面正文、完整 URL（路径/查询串可能带令牌）都不进账本，主机只留 host。
 * 有单测钉住「把 key 与正文塞进入参也不会出现在落库结果里」。
 *
 * 失败静默：记账是旁路信息，任何异常（无 chrome.storage、配额满、JSON 坏）都不得影响
 * 正在进行的模型调用，故所有写路径 swallow 后返回 false。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
  (function (global) {
    /** 环形缓冲上限：够回溯最近若干次调用，又不会把 storage 撑起来。 */
    const MAX_ENTRIES = 200;
    const STORAGE_KEY = 'llmCallLedger';

    /** chrome.storage.local 缺省取值（SW / popup 都走它；测试注入内存实现）。 */
    function defaultStorage() {
      try {
        return global.chrome && global.chrome.storage && global.chrome.storage.local
          ? global.chrome.storage.local
          : null;
      } catch (_) {
        return null;
      }
    }

    /**
     * 只保留主机名：完整 URL 的路径与查询串可能带令牌（有些兼容端点把 key 放 query）。
     * @param {string} rawUrl
     * @returns {string}
     */
    function hostOnly(rawUrl) {
      const raw = String(rawUrl || '').trim();
      if (!raw) return '';
      try {
        return new URL(raw).host;
      } catch (_) {
        // 不是完整 URL 时退回「去掉协议、取第一段」：仍然只留主机部分，绝不返回原串。
        const stripped = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
        return stripped.split(/[/?#]/)[0] || '';
      }
    }

    /** @param {number} n */
    function asCount(n) {
      const v = Number(n);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    }

    /**
     * 把供应商回包的 usage 归一成四分量（exclusive 口径：input 不含缓存命中）。
     *
     * 兼容三种常见形态（与 trae-agent 侧 usage_from_openai_usage 同契约）：
     * - chat.completions：prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens
     * - DeepSeek：prompt_cache_hit_tokens / prompt_cache_miss_tokens
     * - Responses / anthropic 风格：input_tokens / output_tokens / cache_read_input_tokens
     *
     * 「包含式 → exclusive」换算必须在这里做一次：prompt_tokens 把命中缓存的输入也算
     * 在内，直接当「输入」会让缓存命中被重复计一遍，账本上的输入/output 与实际计费
     * 对不上。全零/缺失一律返回 null（= 未记录），不假装成「零消耗」。
     *
     * @param {string|object|null} raw 回包正文（字符串）或已解析的 usage 对象
     * @returns {{input: number, output: number, cacheRead: number, cacheCreation: number}|null}
     */
    function normalizeUsage(raw) {
      let usage = raw;
      if (typeof usage === 'string') {
        try {
          usage = JSON.parse(usage);
        } catch (_) {
          return null;
        }
      }
      if (!usage || typeof usage !== 'object') return null;
      // 入参既可能是整段回包（usage 在顶层），也可能已经是 usage 对象本身。
      if (usage.usage && typeof usage.usage === 'object') usage = usage.usage;

      const prompt = asCount(
        usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens,
      );
      const output = asCount(
        usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens,
      );
      const details = usage.prompt_tokens_details || usage.input_tokens_details || null;
      let cacheRead = asCount(
        details && details.cached_tokens != null ? details.cached_tokens : null,
      );
      if (!cacheRead) cacheRead = asCount(usage.prompt_cache_hit_tokens);
      if (!cacheRead) cacheRead = asCount(usage.cache_read_input_tokens);
      let cacheCreation = asCount(usage.cache_creation_input_tokens);
      if (!cacheCreation) cacheCreation = asCount(usage.prompt_cache_miss_tokens);
      if (!cacheCreation) cacheCreation = asCount(usage.cache_creation_tokens);

      if (!prompt && !output && !cacheRead && !cacheCreation) return null;
      // cached > prompt 的畸形回包：夹到 0，不让 exclusive 换算出现负数。
      return {
        input: Math.max(0, prompt - cacheRead),
        output,
        cacheRead,
        cacheCreation,
      };
    }

    /** @param {{storage?: object, now?: Function, uuid?: Function}} [deps] */
    function runtime(deps) {
      const d = deps || {};
      return {
        storage: d.storage !== undefined ? d.storage : defaultStorage(),
        now: d.now || (() => new Date().toISOString()),
        uuid:
          d.uuid
          || (() => {
            try {
              if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                return global.crypto.randomUUID();
              }
            } catch (_) { /* 回落 */ }
            return `llm-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
          }),
      };
    }

    /**
     * 由入参**构造**（而非透传）一条账目：字段白名单写死在这里，调用方给的对象里
     * 就算带 apiKey / 正文也不会进账本。
     *
     * @param {{source?: string, baseUrl?: string, model?: string, ok?: boolean,
     *          status?: number, durationMs?: number, responseText?: string,
     *          traceId?: string}} call
     * @param {{now: Function, uuid: Function}} rt
     */
    function buildEntry(call, rt) {
      const src = call || {};
      const usage = normalizeUsage(src.responseText);
      const status = asCount(src.status);
      return {
        id: String(src.traceId || '').trim() || rt.uuid(),
        at: rt.now(),
        // 来源限定两种：direct = 用户自填 Key 直连分析；probe = 连通性测试。
        source: src.source === 'probe' ? 'probe' : 'direct',
        host: hostOnly(src.baseUrl),
        model: String(src.model || '').trim().slice(0, 120),
        ok: src.ok === true,
        status,
        durationMs: asCount(src.durationMs),
        tokens: usage,
      };
    }

    /** @param {object} storage @returns {Promise<object[]>} */
    async function readEntries(storage) {
      if (!storage || typeof storage.get !== 'function') return [];
      let got = null;
      try {
        got = await storage.get([STORAGE_KEY]);
      } catch (_) {
        return [];
      }
      const raw = got && got[STORAGE_KEY];
      const entries = raw && Array.isArray(raw.entries) ? raw.entries : [];
      return entries.filter((e) => e && typeof e === 'object');
    }

    /**
     * 记一次调用。返回是否落库成功；任何失败都静默（旁路信息不得影响模型调用）。
     * 写入是「读-改-写」：并发调用可能互相覆盖一条，代价可接受（账本是审计线索，
     * 不是计费依据），换来的是不需要锁与额外的表。
     *
     * @param {object} call 见 buildEntry
     * @param {{storage?: object, now?: Function, uuid?: Function}} [deps]
     * @returns {Promise<boolean>}
     */
    async function recordCall(call, deps) {
      const rt = runtime(deps);
      if (!rt.storage || typeof rt.storage.set !== 'function') return false;
      try {
        const entries = await readEntries(rt.storage);
        entries.push(buildEntry(call, rt));
        const kept = entries.slice(-MAX_ENTRIES);
        await rt.storage.set({ [STORAGE_KEY]: { version: 1, entries: kept } });
        return true;
      } catch (_) {
        return false;
      }
    }

    /**
     * 读账本（新的在前）。导出入口与面板共用。
     * @param {{storage?: object}} [deps]
     * @returns {Promise<object[]>}
     */
    async function listCalls(deps) {
      const rt = runtime(deps);
      const entries = await readEntries(rt.storage);
      return entries.slice().reverse();
    }

    /** 清空账本（用户主动抹掉本机记录）。 @param {{storage?: object}} [deps] */
    async function clearCalls(deps) {
      const rt = runtime(deps);
      if (!rt.storage || typeof rt.storage.set !== 'function') return false;
      try {
        await rt.storage.set({ [STORAGE_KEY]: { version: 1, entries: [] } });
        return true;
      } catch (_) {
        return false;
      }
    }

    /** 导出文件名（纯函数，便于单测钉住日期口径）。 */
    function exportFilename(now) {
      const d = now instanceof Date ? now : new Date();
      return `llm-call-ledger-${d.toISOString().slice(0, 10)}.json`;
    }

    /**
     * 导出成带 BOM 的 JSON 文本：表格工具/编辑器打开中文不乱码，且是一个可直接落盘的
     * 审计附件（只含白名单字段，天然不含密钥与正文）。
     * @param {{storage?: object}} [deps]
     * @returns {Promise<string>}
     */
    async function exportJSON(deps) {
      const entries = await listCalls(deps);
      return `\ufeff${JSON.stringify({ version: 1, exported_at: new Date().toISOString(), entries }, null, 2)}\n`;
    }

    const api = {
      MAX_ENTRIES,
      STORAGE_KEY,
      hostOnly,
      normalizeUsage,
      recordCall,
      listCalls,
      clearCalls,
      exportFilename,
      exportJSON,
    };

    global.PageAdvisorLLMLedger = api;
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = api;
    }
  })(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
