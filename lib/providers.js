/**
 * 第三方 API 支持：主流服务商预置 + 魔搭社区 + 自定义 OpenAI 兼容端点。
 *
 * 设计要点
 * - 这里实现的是与 `@zifeng1023/dsh-bot` 的 `createLlmInvoker(ctx)` **同签名**的
 *   `llm(input)`：入参 `{ provider, model, reasoningEffort, system, prompt, messages, signal, tools }`，
 *   出参 `{ text, usage, toolUses, stopReason }`。因此第三方 provider 可以直接喂给
 *   dsh-bot 的 RoutineRunner，白拿工具循环、运行记录、预算熔断与快照。
 * - 三种线协议：`openai`（/chat/completions，绝大多数）、`anthropic`（/messages）、`gemini`（generateContent）。
 * - 用 `AsyncLocalStorage` 传递「本次运行允许的工具 schema」，避免并发群聊时串台。
 */

import fs from 'node:fs';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';

export const PROVIDER_FILE = 'providers.json';
export const PROTOCOLS = ['openai', 'anthropic', 'gemini'];

/** 预置服务商。`keyEnv` 只是「本机环境变量里已有 key」的便捷入口，真正生效需保存到 providers.json。 */
export const PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    api: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyEnv: ['DEEPSEEK_API_KEY'],
    docs: 'https://platform.deepseek.com/api_keys',
    note: 'DSH 内置通道也能用；这里配置后可绕过宿主直接走 HTTP。',
  },
  {
    id: 'modelscope',
    label: '魔搭社区 ModelScope',
    api: 'openai',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    models: [
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'Qwen/Qwen3-32B',
      'deepseek-ai/DeepSeek-V3.2-Exp',
      'deepseek-ai/DeepSeek-V3.1',
      'Qwen/Qwen2.5-72B-Instruct',
    ],
    keyEnv: ['MODELSCOPE_API_KEY', 'MODELSCOPE_SDK_TOKEN'],
    docs: 'https://modelscope.cn/my/myaccesstoken',
    note: '魔搭的推理 API 兼容 OpenAI 协议，模型名要带 `组织/模型` 前缀。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    keyEnv: ['OPENAI_API_KEY'],
    docs: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'],
    keyEnv: ['ANTHROPIC_API_KEY'],
    docs: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    api: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    docs: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'dashscope',
    label: '阿里云百炼 · 通义千问',
    api: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen-max', 'qwen-plus', 'qwen-turbo'],
    keyEnv: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    docs: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'moonshot',
    label: 'Moonshot · Kimi',
    api: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    keyEnv: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    docs: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    label: '智谱 · GLM',
    api: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4-flash'],
    keyEnv: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
    docs: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
  {
    id: 'volcengine',
    label: '火山方舟 · 豆包',
    api: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-250615', 'doubao-pro-32k'],
    keyEnv: ['ARK_API_KEY', 'VOLCENGINE_API_KEY'],
    docs: 'https://console.volcengine.com/ark',
    note: '方舟也可以把「推理接入点 ID」当模型名，填 ep-xxxx 即可。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    api: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V3.2-Exp',
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'Qwen/Qwen2.5-72B-Instruct',
    ],
    keyEnv: ['SILICONFLOW_API_KEY'],
    docs: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（聚合）',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat-v3.2', 'qwen/qwen3-235b-a22b'],
    keyEnv: ['OPENROUTER_API_KEY'],
    docs: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    label: '本地推理（Ollama / LM Studio）',
    api: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen3:8b', 'llama3.3:70b', 'deepseek-r1:14b'],
    keyEnv: [],
    docs: 'https://ollama.com/download',
    noKey: true,
  },
];

const PRESET_IDS = new Set(PRESETS.map((p) => p.id));

/** 宽松解析 baseUrl：允许用户只填 `api.xxx.com/v1` 或带结尾斜杠/重复的 /v1。 */
export function normalizeBaseUrl(raw, protocol = 'openai') {
  let url = String(raw ?? '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  // 只去掉重复的 /chat/completions 与 /messages，保留 /v1 之类的前缀
  url = url.replace(/\/(chat\/completions|messages|generateContent)$/i, '');
  if (protocol === 'openai' && !/\/v\d+[a-z]*$/i.test(url) && !/\/api\/v\d+$/i.test(url)) {
    // 常见误填：https://api.deepseek.com —— 补 /v1 只在没有版本段时
    if (!/\/v\d/i.test(url)) url += '/v1';
  }
  return url;
}

export function maskKey(key) {
  const s = String(key ?? '');
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

/** 解析 key 引用：`env:NAME` / `file:/abs/path` / 字面量。 */
export function resolveSecret(ref, env = process.env) {
  const raw = String(ref ?? '').trim();
  if (!raw) return '';
  const m = /^env:(.+)$/i.exec(raw);
  if (m) return String(env[m[1].trim()] ?? '').trim();
  const f = /^file:(.+)$/i.exec(raw);
  if (f) {
    try {
      return fs.readFileSync(f[1].trim(), 'utf8').trim();
    } catch {
      return '';
    }
  }
  return raw;
}

function firstEnv(names, env) {
  for (const name of names ?? []) {
    const value = String(env[name] ?? '').trim();
    if (value) return { value, name };
  }
  return { value: '', name: '' };
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 把一条存盘记录与预置合并成「可运行配置」。 */
export function mergeProvider(record, preset = null) {
  const base = { ...(preset ?? {}), ...(record ?? {}) };
  const id = String(base.id ?? record?.id ?? preset?.id ?? '').trim();
  const api = PROTOCOLS.includes(base.api) ? base.api : 'openai';
  return {
    id,
    label: String(base.label ?? id),
    api,
    baseUrl: normalizeBaseUrl(base.baseUrl, api),
    model: String(base.model ?? (base.models ?? [])[0] ?? '').trim(),
    models: Array.isArray(base.models) ? base.models.map((m) => String(m)).filter(Boolean) : [],
    keyRef: String(base.keyRef ?? base.apiKey ?? '').trim(),
    headers: base.headers && typeof base.headers === 'object' ? { ...base.headers } : {},
    temperature: base.temperature === undefined || base.temperature === null ? null : toNumber(base.temperature, null),
    maxTokens: base.maxTokens === undefined || base.maxTokens === null ? null : Math.round(toNumber(base.maxTokens, null)),
    timeoutMs: Math.round(toNumber(base.timeoutMs, 120000)),
    noKey: base.noKey === true,
    preset: Boolean(preset),
    custom: !preset,
    enabled: base.enabled !== false,
    note: String(base.note ?? ''),
    docs: String(base.docs ?? ''),
  };
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Provider 注册表：`<homeDir>/providers.json`。
 * 结构 `{ version, providers: { [id]: record }, updatedAt }`。
 */
export class ProviderRegistry {
  constructor(homeDir, options = {}) {
    this.dir = homeDir;
    this.file = path.join(homeDir, PROVIDER_FILE);
    this.env = options.env ?? process.env;
    this.logger = options.logger ?? null;
    this.als = new AsyncLocalStorage();
    this._cache = null;
    /** 写串行化：多个 UI/工具同时改 providers.json 时避免后写覆盖先写。 */
    this._writeChain = Promise.resolve();
  }

  /** 在写队列里执行「读-改-写」，保证不会丢更新。 */
  withWriteLock(work) {
    const run = this._writeChain.then(work, work);
    this._writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 在某个「运行上下文」里执行：让 llm 适配器知道本次允许哪些工具 schema。 */
  runWith(context, fn) {
    return this.als.run(context ?? {}, fn);
  }

  currentContext() {
    return this.als.getStore() ?? {};
  }

  read() {
    if (this._cache) return this._cache;
    const raw = safeReadJson(this.file);
    this._cache = {
      version: 1,
      providers: raw && typeof raw.providers === 'object' && raw.providers ? raw.providers : {},
    };
    return this._cache;
  }

  invalidate() {
    this._cache = null;
  }

  async write(next) {
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify({ ...next, version: 1, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, this.file);
    this._cache = { version: 1, providers: next.providers ?? {} };
  }

  /** 已保存的记录（含定制过的预置）。 */
  records() {
    return this.read().providers;
  }

  hasRecord(id) {
    return Object.prototype.hasOwnProperty.call(this.records(), String(id));
  }

  /** 组装好的一份配置；未保存的预置也能取到（用于展示默认值）。 */
  get(id) {
    const key = String(id ?? '').trim();
    if (!key) return null;
    const preset = PRESETS.find((p) => p.id === key) ?? null;
    const record = this.records()[key];
    if (!record && !preset) return null;
    return mergeProvider(record, preset);
  }

  /** 第三方通道判定：只要用户保存过这条记录（且启用），就走自建 HTTP，而非宿主 llm。 */
  isThirdParty(id) {
    const key = String(id ?? '').trim();
    const record = this.records()[key];
    if (!record || record.enabled === false) return false;
    return true;
  }

  /** 生效的 key（含 env / file 引用与环境变量兜底）。 */
  keyFor(id) {
    const cfg = this.get(id);
    if (!cfg) return { key: '', source: 'missing' };
    if (cfg.keyRef) {
      const value = resolveSecret(cfg.keyRef, this.env);
      if (!value) return { key: '', source: 'unresolved' };
      return { key: value, source: cfg.keyRef.startsWith('env:') ? 'env-ref' : 'stored' };
    }
    const found = firstEnv(cfg.keyEnv, this.env);
    if (found.value) return { key: found.value, source: `env:${found.name}` };
    return { key: '', source: cfg.noKey ? 'none-required' : 'missing' };
  }

  /** 面向 UI 的列表：预置 + 自定义 + 已配置状态（绝不下发明文 key）。 */
  list() {
    const records = this.records();
    const rows = PRESETS.map((preset) => {
      const record = records[preset.id];
      const merged = mergeProvider(record, preset);
      const { key, source } = this.keyFor(preset.id);
      const envHit = !record ? firstEnv(preset.keyEnv, this.env) : { value: '', name: '' };
      return {
        ...stripSecrets(merged),
        configured: Boolean(record),
        enabled: record ? record.enabled !== false : false,
        hasKey: Boolean(key),
        keySource: source,
        envAvailable: Boolean(envHit.value),
        envName: envHit.name,
      };
    });
    for (const [id, record] of Object.entries(records)) {
      if (PRESET_IDS.has(id)) continue;
      const merged = mergeProvider(record, null);
      const { key, source } = this.keyFor(id);
      rows.push({
        ...stripSecrets(merged),
        configured: true,
        enabled: record.enabled !== false,
        hasKey: Boolean(key),
        keySource: source,
        envAvailable: false,
        envName: '',
      });
    }
    return rows;
  }

  /** 保存（新建或更新）。key 支持 `env:NAME` / `file:...` / 明文。 */
  async save(input) {
    const id = String(input?.id ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/i.test(id)) {
      throw Object.assign(new Error('provider id 需为 2-41 位字母/数字/下划线/短横线'), { code: 'INVALID_PROVIDER_ID' });
    }
    const preset = PRESETS.find((p) => p.id === id) ?? null;
    if (!preset && !input.custom) throw Object.assign(new Error(`未知的预置服务商：${id}（自定义请带 custom: true）`), { code: 'UNKNOWN_PROVIDER' });
    const api = PROTOCOLS.includes(input.api) ? input.api : preset?.api ?? 'openai';
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? preset?.baseUrl, api);
    if (!baseUrl) throw Object.assign(new Error('baseUrl 不能为空'), { code: 'INVALID_BASE_URL' });
    const models = Array.isArray(input.models) && input.models.length ? input.models.map(String) : preset?.models ?? [];
    const record = {
      id,
      label: String(input.label ?? preset?.label ?? id),
      api,
      baseUrl,
      model: String(input.model ?? models[0] ?? '').trim(),
      models: models.map((m) => String(m)),
      keyRef: String(input.keyRef ?? input.apiKey ?? '').trim(),
      headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
      temperature: input.temperature === undefined || input.temperature === null || input.temperature === '' ? null : Number(input.temperature),
      maxTokens: input.maxTokens === undefined || input.maxTokens === null || input.maxTokens === '' ? null : Number(input.maxTokens),
      timeoutMs: input.timeoutMs ? Number(input.timeoutMs) : 120000,
      noKey: input.noKey === undefined ? Boolean(preset?.noKey) : Boolean(input.noKey),
      enabled: input.enabled !== false,
      custom: !preset,
      note: String(input.note ?? preset?.note ?? ''),
      docs: String(input.docs ?? preset?.docs ?? ''),
      updatedAt: new Date().toISOString(),
    };
    await this.withWriteLock(async () => {
      const latest = { ...this.read() };
      latest.providers = { ...latest.providers, [id]: record };
      await this.write(latest);
    });
    return stripSecrets(mergeProvider(record, preset));
  }

  async remove(id) {
    const key = String(id ?? '').trim();
    const next = { ...this.read() };
    if (!next.providers[key]) return false;
    return this.withWriteLock(async () => {
      const latest = { ...this.read() };
      if (!latest.providers[key]) return false;
      delete latest.providers[key];
      await this.write(latest);
      return true;
    });
  }

  async setEnabled(id, enabled) {
    const key = String(id ?? '').trim();
    const record = this.records()[key];
    if (!record) throw Object.assign(new Error(`未配置的服务商：${key}`), { code: 'PROVIDER_NOT_CONFIGURED' });
    return this.withWriteLock(async () => {
      const latest = { ...this.read() };
      const current = latest.providers[key];
      if (!current) throw Object.assign(new Error(`未配置的服务商：${key}`), { code: 'PROVIDER_NOT_CONFIGURED' });
      latest.providers = { ...latest.providers, [key]: { ...current, enabled: Boolean(enabled) } };
      await this.write(latest);
      return true;
    });
  }
}

function stripSecrets(cfg) {
  if (!cfg) return null;
  const { keyRef, ...rest } = cfg;
  return { ...rest, hasKeyRef: Boolean(keyRef), keyRefMasked: keyRef ? maskKey(keyRef) : '' };
}

/* ------------------------------------------------------------------ *
 * 线协议适配
 * ------------------------------------------------------------------ */

function usageFromOpenAI(usage) {
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0);
  const reasoning = Number(usage?.completion_tokens_details?.reasoning_tokens ?? 0);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheHitTokens: cached,
    cacheMissTokens: Math.max(0, input - cached),
    reasoningTokens: reasoning,
    costKind: 'unknown',
  };
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text ?? '' : ''))
      .join('');
  }
  return '';
}

function blocksToOpenAIMessages(messages) {
  const out = [];
  for (const msg of messages ?? []) {
    const blocks = Array.isArray(msg?.content) ? msg.content : [{ type: 'text', text: String(msg?.content ?? '') }];
    const texts = blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '');
    const toolUses = blocks.filter((b) => b?.type === 'tool_use');
    const toolResults = blocks.filter((b) => b?.type === 'tool_result');
    if (msg.role === 'assistant') {
      const assistant = { role: 'assistant', content: texts.join('') || null };
      if (toolUses.length) {
        assistant.tool_calls = toolUses.map((u) => ({
          id: u.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
        }));
      }
      out.push(assistant);
    }
    for (const r of toolResults) {
      out.push({ role: 'tool', tool_call_id: r.tool_use_id ?? '', content: String(r.content ?? '') });
    }
    if (msg.role !== 'assistant' && (texts.length || !toolResults.length)) {
      out.push({ role: msg.role === 'system' ? 'system' : 'user', content: texts.join('') });
    }
  }
  return out;
}

function blocksToAnthropic(messages) {
  const out = [];
  for (const msg of messages ?? []) {
    const blocks = Array.isArray(msg?.content) ? msg.content : [{ type: 'text', text: String(msg?.content ?? '') }];
    const content = [];
    for (const b of blocks) {
      if (b?.type === 'text' && String(b.text ?? '').trim()) content.push({ type: 'text', text: b.text });
      else if (b?.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
      else if (b?.type === 'tool_result') content.push({ type: 'tool_result', tool_use_id: b.tool_use_id, content: String(b.content ?? '') });
    }
    if (!content.length) continue;
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...content);
    else out.push({ role, content });
  }
  return out;
}

function blocksToGemini(messages) {
  const out = [];
  for (const msg of messages ?? []) {
    const blocks = Array.isArray(msg?.content) ? msg.content : [{ type: 'text', text: String(msg?.content ?? '') }];
    const parts = [];
    for (const b of blocks) {
      if (b?.type === 'text' && String(b.text ?? '').trim()) parts.push({ text: b.text });
      else if (b?.type === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input ?? {} } });
      else if (b?.type === 'tool_result') {
        let value = b.content;
        try {
          value = JSON.parse(String(b.content ?? ''));
        } catch {}
        parts.push({ functionResponse: { name: b.name ?? 'tool', response: { result: value } } });
      }
    }
    if (!parts.length) continue;
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

function toolSchemas(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((t) => {
      const name = String(t?.name ?? t?.function?.name ?? '').trim();
      if (!name) return null;
      return {
        name,
        description: String(t?.description ?? t?.function?.description ?? ''),
        parameters: t?.parameters ?? t?.function?.parameters ?? { type: 'object', properties: {} },
      };
    })
    .filter(Boolean);
}

async function readErrorBody(res) {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const json = JSON.parse(text);
      const msg = json?.error?.message ?? json?.message ?? json?.error?.msg ?? json?.msg;
      if (msg) return String(msg);
    } catch {}
    return text.slice(0, 600);
  } catch {
    return '';
  }
}

function buildHeaders(cfg, key) {
  const headers = { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) };
  if (cfg.api === 'anthropic') {
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
    if (key) headers['x-api-key'] = key;
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

async function postJson(url, body, headers, { timeoutMs, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`请求超时（${timeoutMs}ms）`)), timeoutMs);
  const signals = [controller.signal];
  if (signal) signals.push(signal);
  const combined = signals.length > 1 ? AbortSignal.any(signals) : controller.signal;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: combined });
    if (!res.ok) {
      const detail = await readErrorBody(res);
      const err = new Error(`HTTP ${res.status}${detail ? `：${detail}` : ''}`);
      err.code = res.status === 401 || res.status === 403 ? 'PROVIDER_AUTH' : 'PROVIDER_HTTP';
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- openai 协议 --------------------------- */

async function callOpenAI(cfg, key, { messages, tools, temperature, maxTokens, signal }) {
  const body = { model: cfg.model, messages, stream: false };
  const temp = temperature ?? cfg.temperature;
  if (temp !== null && temp !== undefined) body.temperature = temp;
  const max = maxTokens ?? cfg.maxTokens;
  if (max) body.max_tokens = max;
  if (tools?.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: t }));
    body.tool_choice = 'auto';
  }
  const json = await postJson(`${cfg.baseUrl}/chat/completions`, body, buildHeaders(cfg, key), {
    timeoutMs: cfg.timeoutMs,
    signal,
  });
  const choice = json?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const text = contentToText(message.content ?? choice.text ?? '');
  const toolUses = (message.tool_calls ?? [])
    .map((call) => {
      let input = {};
      try {
        input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        input = { _raw: call.function?.arguments ?? '' };
      }
      return { id: call.id, name: call.function?.name, input };
    })
    .filter((t) => t.name);
  return {
    text,
    toolUses,
    usage: usageFromOpenAI(json?.usage),
    stopReason: choice.finish_reason,
    raw: json,
  };
}

/* -------------------------- anthropic 协议 ------------------------- */

async function callAnthropic(cfg, key, { system, messages, tools, temperature, maxTokens, signal }) {
  const body = {
    model: cfg.model,
    max_tokens: maxTokens ?? cfg.maxTokens ?? 4096,
    messages: blocksToAnthropic(messages),
  };
  if (system) body.system = system;
  const temp = temperature ?? cfg.temperature;
  if (temp !== null && temp !== undefined) body.temperature = temp;
  if (tools?.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  const json = await postJson(`${cfg.baseUrl}/messages`, body, buildHeaders(cfg, key), {
    timeoutMs: cfg.timeoutMs,
    signal,
  });
  let text = '';
  const toolUses = [];
  for (const block of json?.content ?? []) {
    if (block?.type === 'text') text += block.text ?? '';
    else if (block?.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input ?? {} });
  }
  const usage = {
    inputTokens: Number(json?.usage?.input_tokens ?? 0),
    outputTokens: Number(json?.usage?.output_tokens ?? 0),
    cacheHitTokens: Number(json?.usage?.cache_read_input_tokens ?? 0),
    cacheMissTokens: 0,
    reasoningTokens: 0,
    costKind: 'unknown',
  };
  usage.cacheMissTokens = Math.max(0, usage.inputTokens - usage.cacheHitTokens);
  return { text, toolUses, usage, stopReason: json?.stop_reason, raw: json };
}

/* --------------------------- gemini 协议 --------------------------- */

async function callGemini(cfg, key, { system, messages, tools, temperature, maxTokens, signal }) {
  const body = { contents: blocksToGemini(messages) };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const generationConfig = {};
  const temp = temperature ?? cfg.temperature;
  if (temp !== null && temp !== undefined) generationConfig.temperature = temp;
  const max = maxTokens ?? cfg.maxTokens;
  if (max) generationConfig.maxOutputTokens = max;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  if (tools?.length) body.tools = [{ functionDeclarations: tools }];
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(key)}`;
  const json = await postJson(url, body, { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) }, {
    timeoutMs: cfg.timeoutMs,
    signal,
  });
  const candidate = json?.candidates?.[0];
  let text = '';
  const toolUses = [];
  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part?.text === 'string') text += part.text;
    else if (part?.functionCall) toolUses.push({ id: `gem_${Math.random().toString(36).slice(2, 10)}`, name: part.functionCall.name, input: part.functionCall.args ?? {} });
  }
  const meta = json?.usageMetadata ?? {};
  const input = Number(meta.promptTokenCount ?? 0);
  const cached = Number(meta.cachedContentTokenCount ?? 0);
  return {
    text,
    toolUses,
    usage: {
      inputTokens: input,
      outputTokens: Number(meta.candidatesTokenCount ?? 0),
      cacheHitTokens: cached,
      cacheMissTokens: Math.max(0, input - cached),
      reasoningTokens: Number(meta.thoughtsTokenCount ?? 0),
      costKind: 'unknown',
    },
    stopReason: candidate?.finishReason,
    raw: json,
  };
}

/**
 * 生成与 dsh-bot `createLlmInvoker(ctx)` 同签名的 llm 函数。
 * 只有 `registry.isThirdParty(providerId)` 为真时才会被调用。
 */
export function createProviderLlm(registry, options = {}) {
  const logger = options.logger ?? null;
  const toolProvider = options.toolSchemas ?? null;

  return async function invokeProvider(input) {
    const providerId = String(input?.provider ?? '').trim();
    const cfg = registry.get(providerId);
    if (!cfg) throw Object.assign(new Error(`未配置的模型服务商：${providerId}`), { code: 'PROVIDER_NOT_CONFIGURED' });
    const effective = input?.model && input.model !== cfg.model ? { ...cfg, model: String(input.model) } : cfg;
    const { key, source } = registry.keyFor(providerId);
    if (!key && !effective.noKey) {
      throw Object.assign(
        new Error(`服务商 ${providerId} 还没有可用的 API Key（可用 env:变量名 引用环境变量，或直接填写）`),
        { code: 'PROVIDER_NO_KEY', source },
      );
    }
    const ctx = registry.currentContext();
    const tools = toolSchemas(input?.tools ?? ctx.tools ?? (toolProvider ? toolProvider() : []));
    const messages = [];
    if (input?.messages?.length) messages.push(...input.messages);
    else messages.push({ role: 'user', content: [{ type: 'text', text: String(input?.prompt ?? '') }] });
    const systemText = input?.system ? String(input.system) : '';
    const withSystem = systemText ? [{ role: 'system', content: [{ type: 'text', text: systemText }] }, ...messages] : messages;

    const args = {
      messages,
      system: systemText || undefined,
      tools,
      temperature: ctx.temperature ?? null,
      maxTokens: input?.maxTokens ?? null,
      signal: input?.signal,
    };
    let out;
    try {
      if (effective.api === 'anthropic') out = await callAnthropic(effective, key, args);
      else if (effective.api === 'gemini') out = await callGemini(effective, key, args);
      else out = await callOpenAI(effective, key, { ...args, messages: withSystem });
    } catch (error) {
      const message = String(error?.message ?? error);
      logger?.warn?.(`[providers] ${providerId}/${effective.model} 调用失败：${message}`);
      throw Object.assign(new Error(`模型返回错误（${providerId}/${effective.model}）：${message}`), {
        code: error?.code ?? 'PROVIDER_CALL_FAILED',
      });
    }
    if (!String(out.text ?? '').trim() && !(out.toolUses ?? []).length) {
      throw Object.assign(
        new Error(
          `模型返回了空内容（${providerId}/${effective.model}）。常见原因：模型名与服务商不匹配、额度用尽、或 max_tokens 太小。`,
        ),
        { code: 'EMPTY_OUTPUT' },
      );
    }
    return {
      text: out.text ?? '',
      usage: out.usage,
      toolUses: out.toolUses ?? [],
      stopReason: out.stopReason,
    };
  };
}

/** 连通性自检：列模型（失败则退化为最小 chat 探针）。 */
export async function testProvider(registry, id, options = {}) {
  const cfg = registry.get(id);
  if (!cfg) throw Object.assign(new Error(`未配置的服务商：${id}`), { code: 'PROVIDER_NOT_CONFIGURED' });
  const { key, source } = registry.keyFor(id);
  if (!key && !cfg.noKey) {
    return { ok: false, id, error: '缺少 API Key', keySource: source, models: [] };
  }
  const headers = buildHeaders(cfg, key);
  const started = Date.now();
  try {
    if (cfg.api === 'openai') {
      const res = await fetch(`${cfg.baseUrl}/models`, { headers, signal: options.signal });
      if (res.ok) {
        const json = await res.json();
        const models = (json?.data ?? json?.models ?? [])
          .map((m) => String(m?.id ?? m?.name ?? ''))
          .filter(Boolean)
          .slice(0, 200);
        return { ok: true, id, models, latencyMs: Date.now() - started, keySource: source, via: 'models' };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, id, error: `鉴权失败（HTTP ${res.status}）`, keySource: source, models: [] };
      }
    }
    // 其它协议 / /models 不可用：直接跑一次最小对话
    const probe = await createProviderLlm(registry, { logger: options.logger })({
      provider: id,
      model: cfg.model,
      system: '你是连通性探针，只需回复 OK。',
      prompt: '回复 OK',
      maxTokens: 16,
      signal: options.signal,
    });
    return {
      ok: true,
      id,
      models: cfg.models,
      latencyMs: Date.now() - started,
      keySource: source,
      via: 'chat',
      sample: String(probe.text ?? '').slice(0, 40),
    };
  } catch (error) {
    return { ok: false, id, error: String(error?.message ?? error), keySource: source, models: [] };
  }
}

/** 拉取服务商模型清单（失败返回空数组，不抛）。 */
export async function listRemoteModels(registry, id, options = {}) {
  const cfg = registry.get(id);
  if (!cfg) return [];
  const { key } = registry.keyFor(id);
  if (cfg.api !== 'openai' || (!key && !cfg.noKey)) return cfg.models ?? [];
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: buildHeaders(cfg, key), signal: options.signal });
    if (!res.ok) return cfg.models ?? [];
    const json = await res.json();
    return (json?.data ?? json?.models ?? []).map((m) => String(m?.id ?? m?.name ?? '')).filter(Boolean).slice(0, 300);
  } catch {
    return cfg.models ?? [];
  }
}

export default { ProviderRegistry, createProviderLlm, testProvider, listRemoteModels, PRESETS, mergeProvider };