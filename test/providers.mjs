/**
 * lib/providers.js 的离线自测：不联网（fetch 全部打桩），不写用户目录（用临时目录）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PRESETS,
  ProviderRegistry,
  createProviderLlm,
  maskKey,
  mergeProvider,
  normalizeBaseUrl,
  resolveSecret,
  testProvider,
} from '../lib/providers.js'

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    const ok = await fn()
    if (ok) {
      passed += 1
      console.log(`  ok   ${name}`)
    } else {
      failures.push(name)
      console.log(`  FAIL ${name}`)
    }
  } catch (error) {
    failures.push(`${name} (${error?.message ?? error})`)
    console.log(`  FAIL ${name} -> ${error?.message ?? error}`)
  }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bot-groups-providers-'))
const env = { ...process.env, TEST_PROVIDER_KEY: 'sk-from-env-1234' }
const registry = new ProviderRegistry(home, { env })

console.log('providers.js')

await check('PRESETS 含魔搭社区与主流服务商', () => {
  const ids = PRESETS.map((p) => p.id)
  return ['deepseek', 'modelscope', 'openai', 'anthropic', 'gemini', 'dashscope', 'moonshot', 'zhipu', 'volcengine', 'siliconflow', 'openrouter', 'ollama'].every((id) => ids.includes(id))
})

await check('魔搭预置指向 ModelScope 推理端点', () => {
  const preset = PRESETS.find((p) => p.id === 'modelscope')
  return Boolean(preset) && preset.baseUrl.includes('api-inference.modelscope.cn') && preset.api === 'openai' && preset.models.length > 0
})

await check('normalizeBaseUrl 补齐协议与去尾斜杠', () => {
  return (
    normalizeBaseUrl('api.deepseek.com/v1/') === 'https://api.deepseek.com/v1' &&
    normalizeBaseUrl('http://127.0.0.1:11434/v1') === 'http://127.0.0.1:11434/v1' &&
    normalizeBaseUrl('https://x.test/v1/chat/completions') === 'https://x.test/v1' &&
    normalizeBaseUrl('') === ''
  )
})

await check('maskKey 只露头尾', () => {
  const masked = maskKey('sk-1234567890abcdef')
  return masked.startsWith('sk-1') && masked.includes('••••') && !masked.includes('234567890')
})

await check('resolveSecret 支持 env: 引用与明文', () => {
  return resolveSecret('env:TEST_PROVIDER_KEY', env) === 'sk-from-env-1234' && resolveSecret('sk-literal', env) === 'sk-literal'
})

await check('resolveSecret 变量不存在时返回空', () => resolveSecret('env:NOT_SET_ANYWHERE', env) === '')

await check('get() 对未保存的预置也能给出默认值', () => {
  const cfg = registry.get('deepseek')
  return Boolean(cfg) && cfg.api === 'openai' && cfg.baseUrl.startsWith('https://api.deepseek.com')
})

await check('isThirdParty() 未保存时走宿主 llm', () => registry.isThirdParty('deepseek') === false)

await check('save() 拒绝非法 id', async () => {
  try {
    await registry.save({ id: 'x', custom: true, baseUrl: 'https://a.test', api: 'openai' })
    return false
  } catch (error) {
    return error.code === 'INVALID_PROVIDER_ID'
  }
})

await check('save() 拒绝未知预置且未标 custom', async () => {
  try {
    await registry.save({ id: 'nope-provider', baseUrl: 'https://a.test', api: 'openai' })
    return false
  } catch (error) {
    return error.code === 'UNKNOWN_PROVIDER'
  }
})

await check('save() 写入自定义服务商并落盘', async () => {
  await registry.save({
    id: 'my-gateway',
    custom: true,
    label: '我的网关',
    api: 'openai',
    baseUrl: 'gateway.test/v1/',
    model: 'my-model',
    models: ['my-model', 'my-model-lite'],
    keyRef: 'env:TEST_PROVIDER_KEY',
    enabled: true,
  })
  const cfg = registry.get('my-gateway')
  const file = path.join(home, 'providers.json')
  return cfg.baseUrl === 'https://gateway.test/v1' && cfg.model === 'my-model' && fs.existsSync(file) && registry.isThirdParty('my-gateway') === true
})

await check('save() 预置可覆盖 baseUrl/模型', async () => {
  await registry.save({ id: 'modelscope', baseUrl: 'https://proxy.test/v1', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', keyRef: 'env:TEST_PROVIDER_KEY' })
  const cfg = registry.get('modelscope')
  return cfg.baseUrl === 'https://proxy.test/v1' && cfg.model.startsWith('Qwen/') && cfg.label.includes('魔搭')
})

await check('list() 不下发明文 key', () => {
  const rows = registry.list()
  const gateway = rows.find((row) => row.id === 'my-gateway')
  const text = JSON.stringify(rows)
  return (
    rows.length === PRESETS.length + 1 &&
    gateway.configured === true &&
    gateway.hasKey === true &&
    gateway.keySource === 'env-ref' &&
    !text.includes('sk-from-env-1234') &&
    gateway.keyRef === undefined
  )
})

await check('keyFor() 识别 env-ref 与 missing', () => {
  return registry.keyFor('my-gateway').source === 'env-ref' && registry.keyFor('my-gateway').key === 'sk-from-env-1234'
})

await check('keyFor() env 变量缺失时报 unresolved', async () => {
  await registry.save({ id: 'dangling-gw', custom: true, api: 'openai', baseUrl: 'https://d.test/v1', model: 'm', keyRef: 'env:NOT_SET_ANYWHERE' })
  const state = registry.keyFor('dangling-gw')
  const row = registry.list().find((item) => item.id === 'dangling-gw')
  await registry.remove('dangling-gw')
  return state.source === 'unresolved' && state.key === '' && row.hasKey === false
})

await check('setEnabled(false) 之后不再走第三方通道', async () => {
  await registry.setEnabled('my-gateway', false)
  const off = registry.isThirdParty('my-gateway') === false
  await registry.setEnabled('my-gateway', true)
  return off && registry.isThirdParty('my-gateway') === true
})

await check('remove() 删除自定义服务商', async () => {
  const removed = await registry.remove('my-gateway')
  return removed === true && registry.get('my-gateway') === null && registry.hasRecord('my-gateway') === false
})

await check('mergeProvider 保留预置文档字段', () => {
  const merged = mergeProvider({ id: 'deepseek', model: 'x' }, PRESETS.find((p) => p.id === 'deepseek'))
  return merged.docs.length > 0 && merged.model === 'x'
})

/* ---------------------- createProviderLlm（fetch 打桩） ---------------------- */

const calls = []
const realFetch = globalThis.fetch
function stubFetch(handler) {
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
}
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return JSON.stringify(body)
    },
    async json() {
      return body
    },
  }
}

const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bot-groups-providers-ok-'))
const okRegistry = new ProviderRegistry(cleanHome, { env })
await okRegistry.save({
  id: 'my-gateway',
  custom: true,
  api: 'openai',
  baseUrl: 'https://gateway.test/v1',
  model: 'my-model',
  keyRef: 'env:TEST_PROVIDER_KEY',
  enabled: true,
})

const llm = createProviderLlm(okRegistry, {
  toolSchemas: () => [{ name: 'bot_group_list', description: 'list', parameters: { type: 'object', properties: {} } }],
})

await check('llm() 返回 text 与 usage', async () => {
  stubFetch(() =>
    jsonResponse({
      choices: [{ message: { content: '你好，我是第三方模型。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 20 } },
    }),
  )
  const out = await llm({ provider: 'my-gateway', model: 'm1', system: '你是助手', prompt: 'hi' })
  const body = JSON.parse(calls[0].init.body)
  return (
    out.text.includes('第三方模型') &&
    out.usage.inputTokens === 120 &&
    out.usage.outputTokens === 8 &&
    out.usage.cacheHitTokens === 20 &&
    body.model === 'm1' &&
    body.messages[0].role === 'system' &&
    body.tools[0].type === 'function'
  )
})

await check('llm() 解析原生 tool_calls', async () => {
  stubFetch(() =>
    jsonResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bot_group_list', arguments: '{"includeArchived":true}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  )
  const out = await llm({ provider: 'my-gateway', model: 'm1', prompt: '列一下群' })
  return out.toolUses.length === 1 && out.toolUses[0].name === 'bot_group_list' && out.toolUses[0].input.includeArchived === true
})

await check('llm() 未知服务商报 PROVIDER_NOT_CONFIGURED', async () => {
  try {
    await llm({ provider: 'nobody', prompt: 'hi' })
    return false
  } catch (error) {
    return error.code === 'PROVIDER_NOT_CONFIGURED'
  }
})

await check('llm() 缺 key 报 PROVIDER_NO_KEY', async () => {
  await okRegistry.save({ id: 'no-key-gw', custom: true, api: 'openai', baseUrl: 'https://nk.test/v1', model: 'm', keyRef: '', enabled: true })
  try {
    await llm({ provider: 'no-key-gw', prompt: 'hi' })
    return false
  } catch (error) {
    return error.code === 'PROVIDER_NO_KEY'
  }
})

await check('llm() 空输出报 EMPTY_OUTPUT', async () => {
  stubFetch(() => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 0 } }))
  try {
    await llm({ provider: 'my-gateway', prompt: 'hi' })
    return false
  } catch (error) {
    return error.code === 'EMPTY_OUTPUT'
  }
})

await check('llm() HTTP 错误带上服务商与模型', async () => {
  stubFetch(() => jsonResponse({ error: { message: 'invalid api key' } }, 401))
  try {
    await llm({ provider: 'my-gateway', prompt: 'hi' })
    return false
  } catch (error) {
    return String(error.message).includes('my-gateway') && /invalid api key/.test(String(error.message))
  }
})

await check('testProvider() 走 /models 并报告可用', async () => {
  stubFetch(() => jsonResponse({ data: [{ id: 'my-model' }, { id: 'my-model-lite' }] }))
  const result = await testProvider(okRegistry, 'my-gateway')
  return result.ok === true && result.via === 'models' && result.models.includes('my-model-lite') && calls[0].url.endsWith('/models')
})

await check('testProvider() 401 时报告鉴权失败', async () => {
  stubFetch(() => jsonResponse({ error: { message: 'unauthorized' } }, 401))
  const result = await testProvider(okRegistry, 'my-gateway')
  return result.ok === false && /鉴权|unauthorized/i.test(String(result.error))
})

await check('并发 runWith 上下文互不串台', async () => {
  const seen = []
  const schemaA = [{ name: 'a', description: '', parameters: { type: 'object', properties: {} } }]
  const schemaB = [{ name: 'b', description: '', parameters: { type: 'object', properties: {} } }]
  stubFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
  const llm2 = createProviderLlm(okRegistry, {})
  await Promise.all([
    okRegistry.runWith({ tools: schemaA }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await llm2({ provider: 'my-gateway', prompt: 'x' })
    }),
    okRegistry.runWith({ tools: schemaB }, async () => {
      await llm2({ provider: 'my-gateway', prompt: 'y' })
    }),
  ])
  for (const call of calls) {
    const body = JSON.parse(call.init.body)
    seen.push((body.tools ?? []).map((t) => t.function.name).join(','))
  }
  return seen.includes('a') && seen.includes('b')
})

globalThis.fetch = realFetch
fs.rmSync(home, { recursive: true, force: true })
fs.rmSync(cleanHome, { recursive: true, force: true })

console.log(`\n通过 ${passed} 项`)
if (failures.length) {
  console.log(`失败 ${failures.length} 项：`)
  for (const item of failures) console.log(` - ${item}`)
  process.exit(1)
}
console.log('全部通过')
