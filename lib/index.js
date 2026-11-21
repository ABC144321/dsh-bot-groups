/**
 * dsh-bot-groups · 宿主端插件
 *
 * 职责：
 * 1. 群数据（GroupStore）：拉群、群消息、@ 交接、轮次。
 * 2. 运行时（BotSupervisor）：优先复用 DSH 里的 Bot 体系，读 ~/.dsh/bot 里的 Bot；
 *    若拿不到 BotService，则直接读 bots/<id>/identity.json（只读降级）。
 * 3. 同源 HTTP API：/_dsh-bot-groups/*，供客户端面板使用。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import fsp from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { pathToFileURL } from 'node:url'

import {
  GroupStore,
  GROUP_MODES,
  buildGroupTaskPrompt,
  clampText,
  expandHome,
  newId,
  normalizeGroup,
  normalizeMember,
  normalizeTask,
  nowIso,
  routeHandoff,
  routeTurn,
} from './store.js'
import { registerBotGroupTools } from './tools.js'
import {
  PRESETS as PROVIDER_PRESETS,
  ProviderRegistry,
  createProviderLlm,
  listRemoteModels,
  testProvider,
} from './providers.js'

export const API_PREFIX = '/_dsh-bot-groups'

export const name = 'dsh-bot-groups'

export const inject = ['tools', 'webServer', 'llm']

const DEFAULT_CONFIG = {
  homeDir: '~/.dsh/bot',
  replyDryRun: false,
  handoffEnabled: true,
  maxBotsPerRound: 6,
  runTimeoutMs: 240000,
  snapshotEnabled: false,
  defaultProvider: 'deepseek',
  defaultModel: 'deepseek-flash',
  defaultReasoningEffort: 'high',
  defaultDailyCny: 5,
  defaultMonthlyCny: 100,
}

const MAX_TEXT = 40000

/** 当前正在执行的群轮次上下文：让 resolveRunnableModel / llm 知道「这是哪个群、用哪个模型」。 */
const groupRuntime = new AsyncLocalStorage()

/** 取宿主注册的工具 schema（与当前会话可见工具一致）。 */
function hostToolSchemas(ctx) {
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

export class GroupError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GroupError'
    this.code = code
  }
}

function statusFor(error) {
  const code = error && error.code
  switch (code) {
    case 'INVALID_ARGS':
    case 'INVALID_PROVIDER_ID':
    case 'UNKNOWN_PROVIDER':
    case 'INVALID_BASE_URL':
    case 'PROVIDER_NOT_CONFIGURED':
    case 'PROVIDER_NO_KEY':
    case 'PROVIDER_AUTH':
    case 'EMPTY_OUTPUT':
      return 400
    case 'GROUP_NOT_FOUND':
    case 'BOT_NOT_FOUND':
    case 'TASK_NOT_FOUND':
      return 404
    case 'GROUP_EXISTS':
    case 'RUN_IN_PROGRESS':
    case 'BUDGET_EXCEEDED':
    case 'DRY_RUN_BLOCKED':
      return 409
    case 'PROVIDER_HTTP':
    case 'PROVIDER_CALL_FAILED':
      return 502
    default:
      return 500
  }
}

function writeJson(res, status, value) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function writeError(res, error) {
  const code = (error && error.code) || 'INTERNAL'
  const message = (error && error.message) || String(error)
  writeJson(res, statusFor(error), { ok: false, code, message })
}

function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        finish(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return finish({})
      try {
        finish(JSON.parse(raw))
      } catch {
        finish(undefined)
      }
    })
    req.on('error', () => finish(undefined))
  })
}

function isLocalRequest(req) {
  const host = String(req.headers.host || '')
  const origin = String(req.headers.origin || '')
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
  if (!local.test(host)) return false
  if (!origin) return true
  try {
    const url = new URL(origin)
    return local.test(url.host)
  } catch {
    return false
  }
}

function jsonValue(value) {
  return { ok: true, value }
}

/* ------------------------------------------------------------------ */
/* Bot 适配层                                                          */
/* ------------------------------------------------------------------ */

function botIdOf(input) {
  if (typeof input === 'string') return input.trim()
  if (input && typeof input === 'object') {
    const candidate = input.botId || input.id
    if (typeof candidate === 'string') return candidate.trim()
  }
  return ''
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

function dshBotCandidates() {
  const candidates = []
  const seen = new Set()
  const push = (file, label) => {
    if (!file || seen.has(file)) return
    seen.add(file)
    candidates.push({ file, label })
  }
  const dirs = []
  if (process.env.DSH_PROFILE_DIR) dirs.push(process.env.DSH_PROFILE_DIR)
  const root = defaultProfilesRoot()
  try {
    const entries = fs.readdirSync(root)
    for (const entry of entries) dirs.push(path.join(root, entry))
  } catch {
    /* 没有 profiles 目录 */
  }
  for (const dir of dirs) {
    push(path.join(dir, 'node_modules', '@zifeng1023', 'dsh-bot', 'lib', 'index.js'), `profile:${dir}`)
    push(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-bot', 'lib', 'index.js'), `profile:${dir}:official`)
  }
  return candidates
}

/**
 * 动态加载 @zifeng1023/dsh-bot，拿它的 BotService / RoutineRunner / Invoker。
 * 先试裸包名（由 DSH 的 host 解析器处理），再试 profile 下的绝对路径。
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
  logger?.warn?.('dsh-bot-groups: 未能加载 @zifeng1023/dsh-bot，群聊将以只读/降级模式运行')
  return { mod: null, label: null, attempts }
}

class BotSupervisor {
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
      runner: null,
      degraded: true,
      reason: null,
      llm: Boolean(ctx.llm),
      tools: Boolean(ctx.tools),
      providers: this.providers,
    }

    const existing = typeof ctx.get === 'function' ? ctx.get('bot') : undefined
    if (existing && typeof existing.list === 'function') {
      state.service = existing
      state.serviceSource = 'ctx.get("bot")'
    }

    if (!mod) {
      state.reason = '未加载 @zifeng1023/dsh-bot（详见 attempts）。群聊仍可记录，但 Bot 无法自动发言。'
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
        state.serviceSource = 'dsh-bot-groups'
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
      this.logger?.warn?.(`dsh-bot-groups: ${state.reason}`)
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
            runCount: bot.runCount,
            lastRunAt: bot.lastRunAt,
            todayCostCny: bot.todayCostCny,
            goalDescription: bot.goalDescription,
            goalStatus: bot.goalStatus,
          }))
        }
      } catch (error) {
        this.logger?.warn?.(`dsh-bot-groups: service.list() 失败：${String(error?.message || error)}`)
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
      })
    }
    bots.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
    return bots
  }

  async getBot(botId) {
    const id = botIdOf(botId)
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

/* ------------------------------------------------------------------ */
/* 群服务                                                              */
/* ------------------------------------------------------------------ */

class GroupService {
  constructor(ctx, config, logger) {
    this.ctx = ctx
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger = logger
    this.store = new GroupStore(this.config.homeDir)
    this.bots = new BotSupervisor(ctx, this.config, logger)
    this.providers = this.bots.providers
    this.roundChains = new Map()
    /** 正在跑的发言：groupId → Set<{ messageId, controller }>，用于「停止」。 */
    this.controllers = new Map()
  }

  /** 停止某群正在进行的发言（中止模型调用，消息标记 stopped）。 */
  async stop(id) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const running = this.controllers.get(id)
    let aborted = 0
    if (running) {
      for (const entry of running) {
        try {
          entry.controller.abort()
          aborted += 1
        } catch {
          /* ignore */
        }
      }
    }
    await this.store.mutate(id, (current) => {
      current.messages = current.messages.map((msg) =>
        msg.status === 'running' ? { ...msg, status: 'failed', stopped: true, error: '已手动停止', text: msg.text || '（已停止）' } : msg,
      )
      current.rounds = current.rounds.map((round) =>
        round.status === 'running' ? { ...round, status: 'stopped', activeBotId: null, finishedAt: nowIso() } : round,
      )
      return current
    })
    return { stopped: aborted, group: await this.detail(id) }
  }

  /** 重试某条发言：把同一个 Bot 再叫一遍，接在最后一条消息之后。 */
  async retry(id, messageId) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const target = messageId ? group.messages.find((msg) => msg.id === messageId) : [...group.messages].reverse().find((m) => m.role === 'bot')
    if (!target) throw new GroupError('INVALID_ARGS', '没有可重试的发言')
    const botId = target.botId
    if (!botId) throw new GroupError('INVALID_ARGS', '这条消息不是 Bot 发出的，无法重试')
    const member = group.members.find((m) => m.botId === botId)
    if (!member) throw new GroupError('BOT_NOT_FOUND', `该 Bot 已不在群里：${botId}`)
    const roundId = this.enqueueRound(id, { queue: [botId], source: 'retry' })
    return { roundId, botId, group: await this.detail(id) }
  }

  /* ---------------------------- 任务看板 ---------------------------- */

  async addTask(id, input) {
    const text = clampText(input?.title ?? '', 400)
    if (!text) throw new GroupError('INVALID_ARGS', '任务标题不能为空')
    const task = await this.store.addTask(id, {
      title: text,
      status: input?.status,
      assignee: input?.assignee,
      createdBy: input?.createdBy || 'human',
    })
    return { task, group: await this.detail(id) }
  }

  async patchTask(id, taskId, patch) {
    const task = await this.store.patchTask(id, taskId, {
      title: patch?.title,
      status: patch?.status,
      assignee: patch?.assignee,
    })
    if (!task) throw new GroupError('TASK_NOT_FOUND', `任务不存在：${taskId}`)
    return { task, group: await this.detail(id) }
  }

  async removeTask(id, taskId) {
    const removed = await this.store.removeTask(id, taskId)
    if (!removed) throw new GroupError('TASK_NOT_FOUND', `任务不存在：${taskId}`)
    return { removed, group: await this.detail(id) }
  }

  /* ---------------------------- 群预算 ---------------------------- */

  async setBudget(id, input) {
    const group = await this.store.mutate(id, (current) => {
      const next = { ...current.budget }
      if (input?.dailyCny !== undefined) next.dailyCny = input.dailyCny === null || input.dailyCny === '' ? null : Math.max(0, Number(input.dailyCny))
      if (input?.monthlyCny !== undefined) next.monthlyCny = input.monthlyCny === null || input.monthlyCny === '' ? null : Math.max(0, Number(input.monthlyCny))
      if (input?.resetSpent === true) next.spentDay = 0
      current.budget = next
      return current
    })
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    return { budget: group.budget, group: await this.detail(id) }
  }

  /** 群级模型绑定：不填则回落到 Bot 自身模型。 */
  async setModel(id, input) {
    const group = await this.store.mutate(id, (current) => {
      current.model = {
        provider: typeof input?.provider === 'string' ? input.provider.trim() : '',
        model: typeof input?.model === 'string' ? input.model.trim() : '',
      }
      return current
    })
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    return { model: group.model, group: await this.detail(id) }
  }

  /* ------------------------- 第三方服务商 ------------------------- */

  providerList() {
    return {
      providers: this.providers.list(),
      presets: PROVIDER_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        api: preset.api,
        baseUrl: preset.baseUrl,
        models: preset.models ?? [],
        keyEnv: preset.keyEnv ?? [],
        noKey: Boolean(preset.noKey),
        docs: preset.docs ?? '',
        note: preset.note ?? '',
      })),
      file: this.providers.file,
    }
  }

  async providerSave(input) {
    const saved = await this.providers.save(input || {})
    return { provider: saved, providers: this.providers.list() }
  }

  async providerRemove(id) {
    const removed = await this.providers.remove(id)
    return { removed, providers: this.providers.list() }
  }

  async providerTest(id) {
    const result = await testProvider(this.providers, id, { logger: this.logger })
    return { ...result, providers: this.providers.list() }
  }

  async providerModels(id) {
    const models = await listRemoteModels(this.providers, id, { logger: this.logger })
    return { id, models }
  }

  /** 给 Bot 换模型（写回 dsh-bot 的 BotService）。 */
  async setBotModel(botId, input) {
    const state = await this.bots.runtime()
    const provider = String(input?.provider ?? '').trim()
    const model = String(input?.model ?? '').trim()
    if (!provider || !model) throw new GroupError('INVALID_ARGS', 'provider 和 model 都不能为空')
    if (state.service && typeof state.service.update === 'function') {
      const updated = await state.service.update(botIdOf(botId), { model: { ...(input || {}), provider, model } })
      return { bot: updated }
    }
    throw new GroupError('BOT_RUNTIME_UNAVAILABLE', state.reason || 'Bot 服务不可用')
  }

  async listBots() {
    return this.bots.listBots()
  }

  async diag() {
    return {
      ...(await this.bots.diag()),
      homeDir: this.store.homeDir,
      groupCount: (await this.store.list()).length,
      providerCount: this.providers.list().filter((row) => row.configured && row.enabled).length,
      dryRun: this.config.replyDryRun === true,
      handoffEnabled: this.config.handoffEnabled !== false,
    }
  }

  async list() {
    const groups = await this.store.list()
    const bots = await this.listBotsSafe()
    const byId = new Map(bots.map((bot) => [bot.id, bot]))
    return Promise.all(groups.map((group) => this.summarize(group, byId)))
  }

  async listBotsSafe() {
    try {
      return await this.bots.listBots()
    } catch {
      return []
    }
  }

  tallyBots(group) {
    const rows = new Map()
    for (const msg of group.messages) {
      if (msg.role !== 'bot') continue
      const key = msg.botId || 'unknown'
      const row = rows.get(key) || { botId: key, name: msg.name || key, messages: 0, costCny: 0, failed: 0 }
      row.messages += 1
      row.costCny = Math.round((row.costCny + (Number.isFinite(msg.costCny) ? msg.costCny : 0)) * 1e6) / 1e6
      if (msg.status === 'failed') row.failed += 1
      rows.set(key, row)
    }
    return [...rows.values()].sort((a, b) => b.messages - a.messages)
  }

  async summarize(group, byId) {
    const members = group.members.map((member) => {
      const bot = byId && byId.get(member.botId)
      return {
        ...member,
        name: member.name || (bot && bot.name) || member.botId,
        role: member.role || (bot && bot.role) || '',
        avatar: member.avatar || (bot && bot.avatar) || '',
        alive: Boolean(bot),
      }
    })
    const lastMeaningful = [...group.messages].reverse().find((msg) => msg.kind !== 'system') || null
    const runningRound = [...group.rounds].reverse().find((round) => round.status === 'running')
    return {
      id: group.id,
      kind: group.kind,
      name: group.name,
      topic: group.topic,
      mode: group.mode,
      leadBotId: group.leadBotId,
      members,
      goal: group.goal,
      goalStatus: group.goalStatus,
      maxRounds: group.maxRounds,
      tasks: group.tasks,
      notes: group.notes,
      budget: group.budget,
      model: group.model,
      byBot: this.tallyBots(group),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      archived: group.archived,
      unread: group.unread,
      stats: group.stats,
      running: Boolean(runningRound),
      activeBotId: runningRound ? runningRound.activeBotId || null : null,
      lastMessage: lastMeaningful
        ? {
            name: lastMeaningful.role === 'human' ? '你' : lastMeaningful.name || lastMeaningful.botId,
            role: lastMeaningful.role,
            text: clampText(lastMeaningful.text, 160),
            at: lastMeaningful.at,
            status: lastMeaningful.status,
          }
        : null,
    }
  }

  async detail(id) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const bots = await this.listBotsSafe()
    const snapshot = await this.summarize(group, new Map(bots.map((bot) => [bot.id, bot])))
    return { ...snapshot, messages: group.messages, rounds: group.rounds }
  }

  async resolveBots(refs) {
    const bots = await this.listBotsSafe()
    const byId = new Map(bots.map((bot) => [bot.id, bot]))
    const byName = new Map(bots.map((bot) => [bot.name, bot]))
    const resolved = []
    const missing = []
    for (const ref of refs) {
      const id = botIdOf(ref)
      const name = typeof ref === 'string' ? ref.trim() : ''
      const bot = byId.get(id) || byId.get(name) || byName.get(name || id)
      if (!bot) {
        missing.push(id || name)
        continue
      }
      resolved.push(normalizeMember({ botId: bot.id, name: bot.name, role: bot.role, avatar: bot.avatar }))
    }
    return { resolved, missing }
  }

  async create(input = {}) {
    const memberRefs = Array.isArray(input.members) ? input.members : Array.isArray(input.botIds) ? input.botIds : []
    if (memberRefs.length === 0) {
      throw new GroupError('INVALID_ARGS', '拉群至少需要一位 Bot 成员')
    }
    const { resolved, missing } = await this.resolveBots(memberRefs)
    if (missing.length > 0) {
      throw new GroupError(
        'BOT_NOT_FOUND',
        `找不到这些 Bot：${missing.join('、')}。请先在 Bot 面板（或 bot_create）里创建。`,
      )
    }
    const kind = input.kind === 'dm' ? 'dm' : 'group'
    const name = kind === 'dm' ? input.name || `${resolved[0]?.name || 'Bot'} 与 你` : input.name
    const leadRef = botIdOf(input.leadBotId)
    const lead = resolved.some((m) => m.botId === leadRef) ? leadRef : resolved[0].botId
    const group = normalizeGroup(
      {
        kind,
        name,
        topic: input.topic,
        avatar: input.avatar,
        mode: input.mode,
        members: resolved,
        leadBotId: lead,
        goal: input.goal,
        goalStatus: input.goal ? 'active' : 'paused',
        maxRounds: input.maxRounds,
        messages: [
          {
            role: 'lead',
            kind: 'system',
            name: '群助手',
            status: 'done',
            text:
              kind === 'dm'
                ? `已和 ${resolved[0].name} 建好私聊。直接说话即可；说 @ 可以换人。`
                : `群已建好，成员：${resolved.map((m) => m.name).join('、')}。主持人：${
                    resolved.find((m) => m.botId === lead)?.name || '未设置'
                  }。`,
          },
        ],
      },
      { homeDir: this.store.homeDir },
    )
    await this.store.save(group)
    await this.store.appendMessage(group.id, {
      role: 'lead',
      kind: 'system',
      name: '群助手',
      text: `本群模式：${modeLabel(group.mode)}；每轮最多 ${group.maxRounds} 位成员接力。`,
    })
    return this.detail(group.id)
  }

  async update(id, patch = {}) {
    const updated = await this.store.mutate(id, (group) => {
      if (typeof patch.name === 'string' && patch.name.trim()) group.name = asText(patch.name, 40)
      if (typeof patch.topic === 'string') group.topic = clampText(patch.topic, 400)
      if (typeof patch.avatar === 'string') group.avatar = patch.avatar.slice(0, 200)
      if (typeof patch.goal === 'string') {
        group.goal = clampText(patch.goal, 2000)
        if (group.goal && group.goalStatus === 'paused' && patch.goalStatus === undefined) group.goalStatus = 'active'
      }
      if (patch.goalStatus === 'active' || patch.goalStatus === 'done' || patch.goalStatus === 'paused') {
        group.goalStatus = patch.goalStatus
      }
      if (GROUP_MODES.includes(patch.mode)) group.mode = patch.mode
      if (Number.isFinite(patch.maxRounds)) group.maxRounds = Math.min(12, Math.max(1, Math.round(patch.maxRounds)))
      if (typeof patch.leadBotId === 'string' && group.members.some((m) => m.botId === patch.leadBotId)) {
        group.leadBotId = patch.leadBotId
      }
      if (patch.archived === true || patch.archived === false) group.archived = patch.archived
      if (patch.unread === 0) group.unread = 0
      if (typeof patch.notes === 'string') group.notes = clampText(patch.notes, 6000)
      return group
    })
    if (!updated) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    return this.detail(id)
  }

  /** 和某个 Bot 的私聊：已存在则复用，否则建一个 dm 群。 */
  async ensureDm(botRef) {
    const { resolved, missing } = await this.resolveBots([botRef])
    if (missing.length > 0 || resolved.length === 0) {
      throw new GroupError('BOT_NOT_FOUND', `找不到这个 Bot：${missing.join('、') || botRef}`)
    }
    const member = resolved[0]
    const groups = await this.store.list()
    const existing = groups.find(
      (group) => group.kind === 'dm' && group.members.length === 1 && group.members[0].botId === member.botId && !group.archived,
    )
    if (existing) return { created: false, group: await this.detail(existing.id) }
    const group = await this.create({
      kind: 'dm',
      name: `${member.name} 与 你`,
      members: [member.botId],
      topic: '',
    })
    return { created: true, group }
  }

  /** 导出为 Markdown（给「导出」按钮与外部脚本用）。 */
  async exportMarkdown(id) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const bots = await this.listBotsSafe()
    const byId = new Map(bots.map((bot) => [bot.id, bot]))
    const stamp = (iso) => {
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
    }
    const lines = []
    lines.push(`# ${group.name}`)
    lines.push('')
    const kindLabel = group.kind === 'dm' ? '私聊' : group.kind === 'team' ? '小组' : '群聊'
    lines.push(`- 类型：${kindLabel}`)
    if (group.topic) lines.push(`- 主题：${group.topic}`)
    if (group.goal) lines.push(`- 目标：${group.goal}（${group.goalStatus}）`)
    lines.push(`- 成员：${group.members.map((m) => m.name || (byId.get(m.botId) || {}).name || m.botId).join('、')}`)
    lines.push(`- 消息：${group.messages.filter((m) => m.kind !== 'system').length} 条｜累计花费：¥${group.stats.costCny.toFixed(6)}`)
    lines.push(`- 导出时间：${stamp(nowIso())}`)
    lines.push('')
    if (group.notes) {
      lines.push('## 备忘录')
      lines.push('')
      lines.push(group.notes)
      lines.push('')
    }
    if (group.tasks.length > 0) {
      lines.push('## 任务看板')
      lines.push('')
      for (const task of group.tasks) {
        const label = task.status === 'done' ? 'x' : ' '
        lines.push(`- [${label}] ${task.title}${task.assignee ? `（${task.assignee}）` : ''}`)
      }
      lines.push('')
    }
    lines.push('## 对话')
    lines.push('')
    for (const msg of group.messages) {
      const who = msg.role === 'human' ? '🧑 你' : msg.role === 'system' ? `· 系统` : `🤖 ${msg.name || msg.botId}`
      const cost = Number.isFinite(msg.costCny) && msg.costCny > 0 ? ` · ¥${msg.costCny.toFixed(6)}` : ''
      const status = msg.status && msg.status !== 'done' ? ` · ${msg.status}` : ''
      lines.push(`**${who}** · ${stamp(msg.at)}${cost}${status}`)
      lines.push('')
      lines.push(msg.text || '')
      lines.push('')
    }
    const safe = group.name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'bot-group'
    return { filename: `${safe}.md`, markdown: lines.join('\n') }
  }

  async invite(id, refs) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const { resolved, missing } = await this.resolveBots(Array.isArray(refs) ? refs : [refs])
    if (missing.length > 0) throw new GroupError('BOT_NOT_FOUND', `找不到这些 Bot：${missing.join('、')}`)
    const existing = new Set(group.members.map((m) => m.botId))
    const added = resolved.filter((member) => !existing.has(member.botId))
    if (added.length === 0) return this.detail(id)
    await this.store.mutate(id, (current) => {
      current.members = [...current.members, ...added]
      if (!current.leadBotId) current.leadBotId = added[0].botId
      return current
    })
    await this.store.appendMessage(id, {
      role: 'lead',
      kind: 'system',
      name: '群助手',
      text: `${added.map((m) => m.name).join('、')} 加入了群聊。`,
    })
    return this.detail(id)
  }

  async removeMembers(id, refs) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const ids = new Set((Array.isArray(refs) ? refs : [refs]).map(botIdOf))
    const removed = group.members.filter((member) => ids.has(member.botId))
    if (removed.length === 0) return this.detail(id)
    if (removed.length >= group.members.length) {
      throw new GroupError('INVALID_ARGS', '群至少需要保留一位成员；如需解散请删除群。')
    }
    await this.store.mutate(id, (current) => {
      current.members = current.members.filter((member) => !ids.has(member.botId))
      if (!current.members.some((member) => member.botId === current.leadBotId)) {
        current.leadBotId = current.members[0].botId
      }
      return current
    })
    await this.store.appendMessage(id, {
      role: 'lead',
      kind: 'system',
      name: '群助手',
      text: `${removed.map((m) => m.name || m.botId).join('、')} 已离开群聊。`,
    })
    return this.detail(id)
  }

  async remove(id) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    await this.store.remove(id)
    return { id }
  }

  async appendSystem(id, text) {
    return this.store.appendMessage(id, { role: 'lead', kind: 'system', name: '群助手', text: clampText(text, 2000) })
  }

  /** 人类发消息；reply=true 时按群模式自动安排 Bot 接力。 */
  async postHuman(id, text, options = {}) {
    const clean = clampText(text, MAX_TEXT)
    const attachments = Array.isArray(options.attachments) ? options.attachments.filter(Boolean).slice(0, 8) : []
    if (!clean && attachments.length === 0) throw new GroupError('INVALID_ARGS', '消息不能为空')
    let group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const message = {
      role: 'human',
      kind: 'message',
      name: options.authorName || '你',
      text: clean,
      mentions: routeMentions(group, clean),
      status: 'done',
      replyTo: typeof options.replyTo === 'string' ? options.replyTo : null,
      attachments,
    }
    group = await this.store.appendMessage(id, message)
    if (group.unread > 0) group = await this.store.mutate(id, (current) => ((current.unread = 0), current))
    const queued = options.reply === false ? [] : routeTurn(group, clean)
    if (queued.length > 0) {
      this.enqueueRound(id, { queue: queued, source: 'human', parentMessageId: group.messages.at(-1)?.id })
    }
    return { group: await this.detail(id), queued }
  }

  /** 手动让指定成员（默认全员）依次发言一轮。 */
  async startRound(id, options = {}) {
    let group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    let queue = Array.isArray(options.botIds) && options.botIds.length > 0
      ? options.botIds.map(botIdOf).filter((botId) => group.members.some((m) => m.botId === botId))
      : group.members.map((member) => member.botId)
    queue = queue.slice(0, Math.min(12, Math.max(1, group.maxRounds || 3)))
    if (queue.length === 0) throw new GroupError('INVALID_ARGS', '没有可发言的成员')
    const roundId = this.enqueueRound(id, { queue, source: options.source || 'panel' })
    return { roundId, queue, group: await this.detail(id) }
  }

  /** 机器人主动发言（工具/外部调用），并默认触发 @ 交接。 */
  async botSpeak(id, botRef, text) {
    const group = await this.store.get(id)
    if (!group) throw new GroupError('GROUP_NOT_FOUND', `群不存在：${id}`)
    const botId = botIdOf(botRef)
    const member = group.members.find((m) => m.botId === botId || m.name === String(botRef))
    if (!member) throw new GroupError('BOT_NOT_FOUND', `Bot 不是本群成员：${String(botRef)}`)
    const clean = clampText(text, MAX_TEXT)
    if (!clean) throw new GroupError('INVALID_ARGS', '发言内容不能为空')
    const after = await this.store.appendMessage(id, {
      role: 'bot',
      botId: member.botId,
      name: member.name,
      kind: 'message',
      text: clean,
      mentions: routeMentions(group, clean),
      status: 'done',
    })
    const handoff = this.config.handoffEnabled === false ? [] : routeHandoff(group, clean, member.botId)
    if (handoff.length > 0) this.enqueueRound(id, { queue: handoff.slice(0, 2), source: 'handoff' })
    return { group: await this.detail(after.id), handoff }
  }

  /** 等某个群当前轮次结束（或超时），给工具调用用。 */
  async waitIdle(id, timeoutMs = 240000) {
    const chain = this.roundChains.get(id)
    if (!chain) return
    let timer = null
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(5000, Math.min(900000, Number(timeoutMs) || 240000)))
    })
    try {
      await Promise.race([chain.catch(() => undefined), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /* --------------------------- 轮次执行 --------------------------- */

  enqueueRound(id, options) {
    const roundId = newId('rnd')
    const previous = this.roundChains.get(id) || Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.runRound(id, { ...options, roundId }))
      .catch((error) => {
        this.logger?.warn?.(`dsh-bot-groups: round ${roundId} failed: ${String(error?.message || error)}`)
      })
    this.roundChains.set(id, next)
    next.finally(() => {
      if (this.roundChains.get(id) === next) this.roundChains.delete(id)
    })
    return roundId
  }

  async runRound(id, options) {
    const { queue: initialQueue, roundId, source } = options
    const queue = [...initialQueue]
    const limit = Math.min(12, Math.max(1, Number(this.config.maxBotsPerRound) || 6))
    const round = {
      id: roundId,
      source: source || 'human',
      startedAt: nowIso(),
      status: 'running',
      queue: [...queue],
      turns: [],
    }
    await this.store.appendRound(id, round)
    const executed = []
    while (queue.length > 0 && executed.length < limit) {
      const botId = queue.shift()
      const group = await this.store.get(id)
      if (!group) return
      const member = group.members.find((m) => m.botId === botId)
      if (!member) continue
      const active = { roundId, activeBotId: botId, updatedAt: nowIso() }
      await this.store.patchRound(id, roundId, active)
      const outcome = await this.speakAs(id, member, group, { roundId })
      executed.push(outcome)
      if (outcome && outcome.handoff) {
        for (const nextId of outcome.handoff) {
          if (!queue.includes(nextId) && executed.length + queue.length < limit) queue.push(nextId)
        }
      }
    }
    await this.store.patchRound(id, roundId, {
      status: 'done',
      finishedAt: nowIso(),
      activeBotId: null,
      turns: executed.map((row) => ({
        botId: row.botId,
        messageId: row.messageId,
        status: row.status,
        costCny: row.costCny,
        error: row.error,
        handoff: row.handoff || [],
      })),
    })
  }

  async speakAs(groupId, member, group, context = {}) {
    const placeholder = await this.store.appendMessage(groupId, {
      role: 'bot',
      botId: member.botId,
      name: member.name,
      kind: 'message',
      text: '',
      status: 'running',
    })
    const messageId = placeholder.messages.at(-1)?.id
    const outcome = { botId: member.botId, messageId, status: 'failed', costCny: 0, error: null, handoff: [] }
    try {
      const state = await this.bots.runtime()
      if (!state.runner) {
        throw new GroupError('BOT_RUNTIME_UNAVAILABLE', state.reason || 'Bot 执行器不可用（未加载 @zifeng1023/dsh-bot）')
      }
      const bot = await this.bots.getBot(member.botId)
      if (!bot) throw new GroupError('BOT_NOT_FOUND', `Bot 已不存在：${member.name}（${member.botId}）`)
      const trigger = [...placeholder.messages].reverse().find((msg) => msg.id !== messageId) || null
      const speaker = { ...member, name: bot.name || member.name }
      const prompt = buildGroupTaskPrompt(
        { ...group, members: group.members.map((m) => (m.botId === member.botId ? speaker : m)) },
        trigger,
        speaker,
      )
      const task = `${prompt}\n\n---\n【群聊任务】请以「${speaker.name}」的身份，写出你要发到群里的话（不要写旁白或规则解释）。`
      const controller = new AbortController()
      const entry = { messageId, controller }
      const bag = this.controllers.get(groupId) || new Set()
      bag.add(entry)
      this.controllers.set(groupId, bag)
      const timer = setTimeout(() => controller.abort(), Math.max(30000, Number(this.config.runTimeoutMs) || 240000))
      const scopedModel =
        group.model && group.model.provider && group.model.model ? { ...group.model } : null
      let record = null
      try {
        record = await this.providers.runWith(
          { tools: hostToolSchemas(this.ctx), temperature: null },
          () =>
            groupRuntime.run({ groupId, model: scopedModel }, () =>
              state.runner.runTask(
                member.botId,
                task,
                { dryRun: this.config.replyDryRun === true, trigger: 'group' },
                controller.signal,
              ),
            ),
        )
      } finally {
        clearTimeout(timer)
        bag.delete(entry)
        if (bag.size === 0) this.controllers.delete(groupId)
      }
      const steps = Array.isArray(record?.steps) ? record.steps : []
      const rawText = steps[0]?.result?.output ?? ''
      const text = sanitizeReply(rawText)
      const cost = Number(record?.usage?.costCny) || 0
      const dryRun = record?.dryRun === true
      const status = dryRun ? 'blocked' : record?.status === 'failed' ? 'failed' : 'done'
      const error = record?.error ? `${record.error.code}: ${record.error.message}` : null
      const handoff = this.config.handoffEnabled === false ? [] : routeHandoff(group, text, member.botId)
      await this.store.patchMessage(groupId, messageId, {
        text: text || (error ? `（发言失败：${error}）` : '（本轮没有输出）'),
        status: text ? status : 'failed',
        runId: record?.id,
        costCny: cost,
        error: error || undefined,
        mentions: handoff,
        replyTo: trigger && trigger.id ? trigger.id : null,
      })
      if (cost > 0) {
        try {
          await this.store.recordSpend(groupId, cost)
        } catch {
          /* 预算记录失败不影响发言 */
        }
      }
      Object.assign(outcome, { status: text ? status : 'failed', costCny: cost, error, handoff })
      return outcome
    } catch (error) {
      const message = String(error?.message || error)
      const stopped = error?.name === 'AbortError' || /aborted/i.test(message)
      await this.store.patchMessage(groupId, messageId, {
        text: stopped ? '（已手动停止）' : `（${member.name} 发言失败：${message}）`,
        status: 'failed',
        stopped,
        error: message,
      })
      outcome.error = message
      return outcome
    }
  }
}

function asText(value, max) {
  const text = String(value ?? '').trim()
  return text.length > max ? text.slice(0, max) : text
}

function routeMentions(group, text) {
  try {
    return Array.from(new Set(parseMentionsLite(text, group.members)))
  } catch {
    return []
  }
}

function parseMentionsLite(text, members) {
  const found = []
  for (const member of members) {
    const tokens = [member.name, member.botId].filter((token) => typeof token === 'string' && token.length > 0)
    if (tokens.some((token) => text.includes('@' + token))) found.push(member.botId)
  }
  return found
}

/** 去掉模型常见的旁白/代码围栏，避免把元信息发进群里。 */
function sanitizeReply(text) {
  let out = String(text || '').trim()
  if (!out) return ''
  const fence = /^```(?:[a-zA-Z0-9_-]*)\n([\s\S]*?)\n```$/.exec(out)
  if (fence) out = fence[1].trim()
  out = out.replace(/^(?:群聊回复|回复|发言)[:：]\s*/u, '')
  const limit = 8000
  return out.length > limit ? out.slice(0, limit) : out
}

export function modeLabel(mode) {
  switch (mode) {
    case 'round-robin':
      return '依次发言'
    case 'panel':
      return '全员圆桌'
    case 'moderated':
      return '主持人主导'
    default:
      return '智能 @ 路由'
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function makeRoutes(service, config) {
  const prefix = API_PREFIX

  const handle = async (req, res, segments, query) => {
    const method = req.method || 'GET'

    if (segments.length === 0 || segments[0] === 'overview') {
      if (method !== 'GET') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
      const [groups, bots, diag] = await Promise.all([service.list(), service.listBotsSafe(), service.diag()])
      return writeJson(
        res,
        200,
        jsonValue({
          groups,
          bots,
          diag,
          modes: GROUP_MODES,
          dryRun: config.replyDryRun === true,
          providers: service.providerList().providers,
        }),
      )
    }

    if (segments[0] === 'diag' && segments.length === 1) {
      if (method !== 'GET') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
      return writeJson(res, 200, jsonValue(await service.diag()))
    }

    if (segments[0] === 'dm') {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
      const body = (await readJsonBody(req)) || {}
      const ref = body.botId || body.bot || body.members
      if (!ref || (Array.isArray(ref) && ref.length === 0)) {
        return writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '需要 botId' })
      }
      const target = Array.isArray(ref) ? ref[0] : ref
      const result = await service.ensureDm(target)
      return writeJson(res, 200, jsonValue(result))
    }

    if (segments[0] === 'bots') {
      if (segments.length === 1) {
        if (method !== 'GET') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
        return writeJson(res, 200, jsonValue({ bots: await service.listBotsSafe() }))
      }
      if (segments.length === 3 && segments[2] === 'model' && method === 'POST') {
        const body = (await readJsonBody(req)) || {}
        const result = await service.setBotModel(segments[1], body)
        return writeJson(res, 200, jsonValue(result))
      }
      return writeJson(res, 404, { ok: false, code: 'NOT_FOUND' })
    }

    if (segments[0] === 'providers') {
      if (segments.length === 1) {
        if (method === 'GET') return writeJson(res, 200, jsonValue(service.providerList()))
        if (method !== 'POST') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
        const body = await readJsonBody(req)
        if (!body) return writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '请求体不是合法 JSON' })
        return writeJson(res, 200, jsonValue(await service.providerSave(body)))
      }
      const pid = segments[1]
      const sub = segments[2]
      if (segments.length === 2 && method === 'DELETE') {
        return writeJson(res, 200, jsonValue(await service.providerRemove(pid)))
      }
      if (segments.length === 3 && sub === 'models' && method === 'GET') {
        return writeJson(res, 200, jsonValue(await service.providerModels(pid)))
      }
      if (segments.length === 3 && sub === 'test' && method === 'POST') {
        return writeJson(res, 200, jsonValue(await service.providerTest(pid)))
      }
      if (segments.length === 3 && sub === 'enable' && method === 'POST') {
        const body = (await readJsonBody(req)) || {}
        await service.providers.setEnabled(pid, body.enabled !== false)
        return writeJson(res, 200, jsonValue({ providers: service.providers.list() }))
      }
      return writeJson(res, 404, { ok: false, code: 'NOT_FOUND' })
    }

    if (segments[0] !== 'groups') {
      return writeJson(res, 404, { ok: false, code: 'NOT_FOUND' })
    }

    // POST /groups
    if (segments.length === 1) {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
      const body = await readJsonBody(req)
      if (!body) return writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '请求体不是合法 JSON' })
      const group = await service.create(body)
      return writeJson(res, 200, jsonValue({ group }))
    }

    const id = segments[1]
    const action = segments[2]

    if (segments.length === 2) {
      if (method === 'GET') return writeJson(res, 200, jsonValue({ group: await service.detail(id) }))
      if (method === 'DELETE') return writeJson(res, 200, jsonValue(await service.remove(id)))
      return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
    }

    if (segments.length === 3 && action === 'export' && method === 'GET') {
      return writeJson(res, 200, jsonValue(await service.exportMarkdown(id)))
    }

    if (method !== 'POST') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
    const body = (await readJsonBody(req)) || undefined
    if (body === undefined) return writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '请求体不是合法 JSON' })

    switch (action) {
      case 'messages': {
        const result = await service.postHuman(id, body.text, {
          reply: body.reply !== false,
          authorName: body.authorName,
          replyTo: body.replyTo,
          attachments: body.attachments,
        })
        return writeJson(res, 200, jsonValue(result))
      }
      case 'rounds': {
        const result = await service.startRound(id, { botIds: body.botIds, source: body.source || 'panel' })
        return writeJson(res, 200, jsonValue(result))
      }
      case 'speak': {
        const result = await service.botSpeak(id, body.botId, body.text)
        return writeJson(res, 200, jsonValue(result))
      }
      case 'stop': {
        const result = await service.stop(id)
        return writeJson(res, 200, jsonValue(result))
      }
      case 'retry': {
        const result = await service.retry(id, body.messageId)
        return writeJson(res, 200, jsonValue(result))
      }
      case 'tasks': {
        const taskId = segments[3]
        if (taskId) {
          if (body.remove === true) return writeJson(res, 200, jsonValue(await service.removeTask(id, taskId)))
          return writeJson(res, 200, jsonValue(await service.patchTask(id, taskId, body)))
        }
        return writeJson(res, 200, jsonValue(await service.addTask(id, body)))
      }
      case 'budget': {
        return writeJson(res, 200, jsonValue(await service.setBudget(id, body)))
      }
      case 'model': {
        return writeJson(res, 200, jsonValue(await service.setModel(id, body)))
      }
      case 'invite': {
        const group = await service.invite(id, body.botIds || body.members || [])
        return writeJson(res, 200, jsonValue({ group }))
      }
      case 'remove-members': {
        const group = await service.removeMembers(id, body.botIds || [])
        return writeJson(res, 200, jsonValue({ group }))
      }
      case 'update': {
        const group = await service.update(id, body)
        return writeJson(res, 200, jsonValue({ group }))
      }
      case 'read': {
        const group = await service.update(id, { unread: 0 })
        return writeJson(res, 200, jsonValue({ group }))
      }
      default:
        return writeJson(res, 404, { ok: false, code: 'NOT_FOUND' })
    }
  }

  return [
    {
      kind: 'prefix',
      path: prefix,
      handler: async (req, res) => {
        try {
          if (!isLocalRequest(req)) {
            writeJson(res, 403, { ok: false, code: 'FORBIDDEN', message: '只接受本机同源请求' })
            return
          }
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          const rest = url.pathname.slice(prefix.length).replace(/^\/+/, '')
          const segments = rest.length > 0 ? rest.split('/').filter(Boolean).map(decodeURIComponent) : []
          await handle(req, res, segments, url.searchParams)
        } catch (error) {
          writeError(res, error)
        }
      },
    },
  ]
}

/* ------------------------------------------------------------------ */
/* 插件入口                                                             */
/* ------------------------------------------------------------------ */

export async function apply(ctx, config = {}) {
  const logger = ctx.logger || {}
  const service = new GroupService(ctx, config || {}, logger)
  try {
    if (typeof ctx.set === 'function') ctx.set('botGroups', service)
  } catch (error) {
    logger?.warn?.(`dsh-bot-groups: ctx.set('botGroups') 失败：${String(error?.message || error)}`)
  }

  const routes = makeRoutes(service, service.config)
  for (const route of routes) {
    const dispose = ctx.webServer.register(route)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => dispose, `dsh-bot-groups: route ${route.path}`)
    }
  }

  // 预热运行时（不阻塞插件加载）
  service.bots.runtime().catch((error) => {
    logger?.warn?.(`dsh-bot-groups: 运行时预热失败：${String(error?.message || error)}`)
  })

  try {
    const count = registerBotGroupTools(ctx, service, logger)
    logger?.info?.(`dsh-bot-groups: 已注册 ${count} 个群聊工具`)
  } catch (error) {
    logger?.warn?.(`dsh-bot-groups: 注册群聊工具失败：${String(error?.message || error)}`)
  }

  logger?.info?.('dsh-bot-groups: Bot 群已就绪')
}

export default { name, inject, apply }
