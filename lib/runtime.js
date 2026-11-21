/**
 * dsh-grok-bot · Bot 运行时适配层
 *
 * 目标：在 DSH 宿主里尽量稳定地拿到 Bot 服务与 RoutineRunner。
 * 1. 优先复用宿主已注册的 `ctx.get('bot')`（最可靠，不依赖模块解析）；
 * 2. 再尝试动态 import `@zifeng1023/dsh-bot`：裸包名 → 常见安装目录 →
 *    require.resolve 解析出的绝对路径；
 * 3. 全部失败时退化为「只读 Bot 列表」，群聊仍可记录消息。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { expandHome, newId, nowIso } from './store.js'
import { createProviderLlm, ProviderRegistry } from './providers.js'
import { GroupError } from './errors.js'

/** 当前正在执行的群轮次上下文：让 resolveRunnableModel / llm 知道「这是哪个群、用哪个模型」。 */
export const groupRuntime = new AsyncLocalStorage()

/** 取宿主注册的工具 schema（与当前会话可见工具一致）。 */
export function hostToolSchemas(ctx) {
  try {
    if (ctx?.tools && typeof ctx.tools.schemas === 'function') {
      const rows = ctx.tools.schemas()
      return Array.isArray(rows) ? rows : []
    }
  } catch {
    /* 忽略：拿不到工具就按无工具调用 */
  }
  return []
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function defaultProfilesRoot() {
  return path.join(os.homedir(), '.dsh', 'profiles')
}

/**
 * 所有可能装了 @zifeng1023/dsh-bot 的目录。
 * 老实现只硬编码 ~/.dsh/profiles/*，这是「Bot 不可用」的主要根因。
 */
function botInstallDirs() {
  const dirs = []
  const add = (dir) => {
    if (typeof dir === 'string' && dir.length > 0 && !dirs.includes(dir)) dirs.push(dir)
  }
  add(process.env.DSH_BOT_DIR)
  add(process.env.DSH_PROFILE_DIR)
  const home = os.homedir()
  for (const sub of ['.dsh', '.dsh/plugins', '.dsh/extensions', '.dsh/node_modules', '.dsh/bot']) {
    add(path.join(home, sub))
  }
  try {
    for (const entry of fs.readdirSync(defaultProfilesRoot())) add(path.join(defaultProfilesRoot(), entry))
  } catch {
    /* 没有 profiles 目录 */
  }
  add(process.cwd())
  add(path.dirname(process.execPath))
  if (process.resourcesPath) add(process.resourcesPath)
  return dirs
}

function dshBotCandidates() {
  const candidates = []
  const seen = new Set()
  const push = (file, label) => {
    if (typeof file !== 'string' || !file || seen.has(file)) return
    seen.add(file)
    candidates.push({ file, label })
  }
  for (const dir of botInstallDirs()) {
    push(path.join(dir, 'node_modules', '@zifeng1023', 'dsh-bot', 'lib', 'index.js'), `dir:${dir}`)
    push(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-bot', 'lib', 'index.js'), `dir:${dir}:official`)
    try {
      const req = createRequire(path.join(dir, 'package.json'))
      push(req.resolve('@zifeng1023/dsh-bot'), `require:${dir}`)
    } catch {
      /* 该目录没装 */
    }
  }
  try {
    push(createRequire(import.meta.url).resolve('@zifeng1023/dsh-bot'), 'require:self')
  } catch {
    /* 插件自身依赖里也没有 */
  }
  return candidates
}

/**
 * 动态加载 @zifeng1023/dsh-bot，拿它的 BotService / RoutineRunner / Invoker。
 * 先试裸包名（由 DSH 的 host 解析器处理），再试绝对路径。
 */
async function loadDshBotModule(logger) {
  const attempts = []
  const tryImport = async (specifier, label) => {
    try {
      const mod = await import(specifier)
      attempts.push({ label, ok: true })
      return { mod, label }
    } catch (error) {
      attempts.push({ label, ok: false, code: error?.code, message: String(error?.message || error).slice(0, 400) })
      return null
    }
  }
  const bare = await tryImport('@zifeng1023/dsh-bot', 'bare:@zifeng1023/dsh-bot')
  if (bare && typeof bare.mod?.BotService === 'function') return { ...bare, attempts }
  for (const candidate of dshBotCandidates()) {
    const hit = await tryImport(pathToFileURL(candidate.file).href, candidate.label)
    if (hit && typeof hit.mod?.BotService === 'function') return { ...hit, attempts }
  }
  logger?.warn?.('dsh-grok-bot: 未能加载 @zifeng1023/dsh-bot，群聊将以只读/降级模式运行')
  return { mod: null, label: null, attempts }
}

export class BotSupervisor {
  constructor(ctx, config, logger) {
    this.ctx = ctx
    this.config = config
    this.logger = logger
    this.loaded = null
    this.loading = null
    this.homeDir = expandHome(config.homeDir)
    /** 第三方模型服务商注册表（providers.json），与 dsh-bot 的数据目录保持一致。 */
    this.providers = new ProviderRegistry(this.homeDir, { logger })
  }

  async runtime() {
    if (this.loaded) return this.loaded
    if (!this.loading) {
      this.loading = this.build().finally(() => {
        this.loading = null
      })
    }
    return this.loading
  }

  async build() {
    const loaded = await loadDshBotModule(this.logger)
    const mod = loaded.mod
    const ctx = this.ctx
    const homeDir = expandHome(this.config.homeDir)
    const state = {
      module: mod ? loaded.label : null,
      attempts: loaded.attempts,
      homeDir,
      service: null,
      serviceSource: null,
      runner: null,
      degraded: true,
      reason: null,
      llm: Boolean(ctx.llm),
      tools: Boolean(ctx.tools),
      providers: this.providers,
    }

    // ① 宿主已经注册了 Bot 服务：先拿到手，即使模块加载失败也不丢。
    const existing = typeof ctx.get === 'function' ? ctx.get('bot') : undefined
    if (existing && typeof existing.list === 'function') {
      state.service = existing
      state.serviceSource = 'ctx.get("bot")'
    }

    if (!mod) {
      state.reason = existing
        ? '未加载 @zifeng1023/dsh-bot 模块：Bot 列表可用，但无法自动发言。请确认 Bot 插件与群插件在同一 profile。'
        : '未加载 @zifeng1023/dsh-bot（详见 attempts）。群聊仍可记录，但 Bot 无法自动发言。'
      this.loaded = state
      return state
    }

    try {
      const serviceConfig = {
        ...(mod.DEFAULT_CONFIG || {}),
        ...this.config,
        homeDir,
        defaultProvider: this.config.defaultProvider,
        defaultModel: this.config.defaultModel,
        defaultReasoningEffort: this.config.defaultReasoningEffort,
        defaultDailyCny: this.config.defaultDailyCny,
        defaultMonthlyCny: this.config.defaultMonthlyCny,
      }
      if (!state.service) {
        state.service = new mod.BotService(ctx, serviceConfig)
        state.serviceSource = 'dsh-grok-bot'
      }

      const hostLlm = mod.createLlmInvoker(ctx)
      const thirdPartyLlm = createProviderLlm(this.providers, {
        logger: this.logger,
        toolSchemas: () => hostToolSchemas(ctx),
      })
      const toolInvoker = mod.createToolInvoker(ctx)
      const self = this
      state.runner = new mod.RoutineRunner({
        service: state.service,
        llm: async (input) => {
          const provider = String(input?.provider ?? '')
          if (self.providers.isThirdParty(provider)) {
            try {
              return await thirdPartyLlm(input)
            } catch (error) {
              throw new GroupError(error?.code || 'PROVIDER_CALL_FAILED', String(error?.message || error))
            }
          }
          try {
            return await hostLlm(input)
          } catch (error) {
            throw new GroupError('LLM_UNAVAILABLE', String(error?.message || error))
          }
        },
        tools: toolInvoker,
        newId,
        nowIso,
        snapshotEnabled: this.config.snapshotEnabled === true,
        resolveRunnableModel: async (bot) => {
          const binding = bot?.model || {}
          const scoped = groupRuntime.getStore() || {}
          const override = scoped.model && typeof scoped.model === 'object' ? scoped.model : {}
          const provider = override.provider || binding.provider || self.config.defaultProvider
          const model = override.model || binding.model || self.config.defaultModel
          return {
            provider,
            model,
            reasoningEffort: binding.reasoningEffort || self.config.defaultReasoningEffort,
            fallbackUsed: false,
          }
        },
      })
      state.providers = this.providers
      state.degraded = false
    } catch (error) {
      state.reason = `初始化 Bot 运行时失败：${String(error?.message || error)}`
      this.logger?.warn?.(`dsh-grok-bot: ${state.reason}`)
    }

    this.loaded = state
    return state
  }

  async listBots() {
    const state = await this.runtime()
    if (state.service && typeof state.service.list === 'function') {
      try {
        const rows = await state.service.list()
        if (Array.isArray(rows)) {
          return rows.map((bot) => ({
            id: bot.id,
            name: bot.name,
            role: bot.role,
            avatar: bot.avatar || '',
            model: bot.model,
            workspace: bot.workspace,
            runCount: bot.runCount,
            lastRunAt: bot.lastRunAt,
            todayCostCny: bot.todayCostCny,
            goalDescription: bot.goalDescription,
            goalStatus: bot.goalStatus,
          }))
        }
      } catch (error) {
        this.logger?.warn?.(`dsh-grok-bot: service.list() 失败：${String(error?.message || error)}`)
      }
    }
    // 降级：直接读目录
    const dir = path.join(state.homeDir, 'bots')
    let entries = []
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const bots = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const identity = await readJson(path.join(dir, entry.name, 'identity.json'))
      if (!identity || typeof identity.id !== 'string') continue
      bots.push({
        id: identity.id,
        name: identity.name || identity.id,
        role: identity.role || '',
        avatar: identity.avatar || '',
        model: identity.model,
        workspace: identity.workspace,
      })
    }
    bots.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
    return bots
  }

  async getBot(botId) {
    const id = String(botId || '').trim()
    if (!id) return null
    const state = await this.runtime()
    if (state.service && typeof state.service.get === 'function') {
      try {
        const bot = await state.service.get(id)
        if (bot) return bot
      } catch {
        /* 继续降级 */
      }
    }
    const identity = await readJson(path.join(state.homeDir, 'bots', id, 'identity.json'))
    return identity
  }

  /** Bot 的 workspace 绝对路径（dsh-bot 的沙箱只允许在 workspace 内写文件）。 */
  workspaceOf(bot, botId) {
    const raw = typeof bot?.workspace === 'string' && bot.workspace ? bot.workspace : ''
    if (raw) return path.resolve(expandHome(raw))
    const homeDir = this.loaded?.homeDir || expandHome(this.config.homeDir)
    return path.join(homeDir, 'bots', String(botId), 'workspace')
  }

  async diag() {
    const state = await this.runtime()
    return {
      module: state.module,
      serviceSource: state.serviceSource || null,
      degraded: state.degraded,
      reason: state.reason,
      attempts: state.attempts,
      homeDir: state.homeDir,
      llm: state.llm,
      tools: state.tools,
    }
  }
}
