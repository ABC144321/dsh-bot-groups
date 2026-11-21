/**
 * dsh-bot-groups · 群聊数据层
 *
 * 每个群是一个 JSON 文件：<homeDir>/groups/<groupId>.json
 * 只用 Node 内置模块，不依赖 DSH 内部包，方便独立测试。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const GROUP_MODES = ['mentions', 'round-robin', 'panel', 'moderated']

export const GROUP_KINDS = ['group', 'dm', 'team']

export const MAX_MESSAGES = 600

export function expandHome(input) {
  if (typeof input !== 'string' || input.length === 0) return input
  if (input === '~') return os.homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

let counter = 0

export function newId(prefix) {
  counter = (counter + 1) % 100000
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${stamp}${counter.toString(36)}${rand}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function clampText(value, max = 4000) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\r\n/g, '\n').trim()
  return text.length > max ? text.slice(0, max) : text
}

export function asName(value, fallback = '未命名群') {
  const text = clampText(value, 40).replace(/\s+/g, ' ')
  return text.length > 0 ? text : fallback
}

/** 把一段文本里的 @名字 / @bot_xxx 解析成 botId 列表（按出现位置保序去重）。 */
export function parseMentions(text, members = []) {
  if (typeof text !== 'string' || text.length === 0) return []
  const names = new Map()
  for (const member of members) {
    if (!member || typeof member.botId !== 'string') continue
    if (typeof member.name === 'string' && member.name.length > 0) names.set(member.name, member.botId)
    names.set(member.botId, member.botId)
  }
  const hits = []
  for (const [token, botId] of names) {
    const needle = '@' + token
    let from = 0
    let at = -1
    while (from <= text.length) {
      const index = text.indexOf(needle, from)
      if (index < 0) break
      const next = text.charAt(index + needle.length)
      if (next === '' || !/[A-Za-z0-9_-]/.test(next)) {
        at = index
        break
      }
      from = index + 1
    }
    if (at >= 0) hits.push({ botId, at })
  }
  hits.sort((a, b) => a.at - b.at)
  const result = []
  const seen = new Set()
  for (const hit of hits) {
    if (seen.has(hit.botId)) continue
    seen.add(hit.botId)
    result.push(hit.botId)
  }
  // 兜底：@main 之类没有对应成员的提及不处理
  return result
}

/** 去掉 @名字 前缀，避免机器人自己读自己的点名（保留内容主体）。 */
export function stripMentions(text, members = []) {
  let out = typeof text === 'string' ? text : ''
  for (const member of members) {
    if (!member) continue
    for (const token of [member.botId, typeof member.name === 'string' ? member.name : '']) {
      if (!token) continue
      out = out.split('@' + token).join('')
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').trim()
}

export function normalizeMember(input) {
  const botId = typeof input === 'string' ? input : input && input.botId
  if (typeof botId !== 'string' || botId.length === 0) {
    throw new Error('成员需要 botId')
  }
  const source = typeof input === 'string' ? {} : input
  const avatar = typeof source.avatar === 'string' ? source.avatar : ''
  return {
    botId,
    name: typeof source.name === 'string' && source.name.length > 0 ? source.name : botId,
    role: typeof source.role === 'string' ? source.role : '',
    avatar,
    joinedAt: typeof source.joinedAt === 'string' ? source.joinedAt : nowIso(),
  }
}

export function normalizeMessage(input) {
  const kind = input.kind === 'system' ? 'system' : 'message'
  return {
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : newId('msg'),
    role: input.role === 'lead' || input.role === 'bot' ? input.role : 'human',
    botId: typeof input.botId === 'string' ? input.botId : undefined,
    name: typeof input.name === 'string' ? input.name : '',
    kind,
    text: clampText(input.text, 40000),
    mentions: Array.isArray(input.mentions) ? input.mentions.filter((x) => typeof x === 'string') : [],
    status: ['queued', 'running', 'done', 'failed', 'blocked'].includes(input.status) ? input.status : 'done',
    runId: typeof input.runId === 'string' ? input.runId : undefined,
    costCny: typeof input.costCny === 'number' && Number.isFinite(input.costCny) ? input.costCny : 0,
    error: typeof input.error === 'string' ? input.error : undefined,
    at: typeof input.at === 'string' ? input.at : nowIso(),
  }
}

export function normalizeRound(input) {
  const source = input && typeof input === 'object' ? input : {}
  const botIds = Array.isArray(source.botIds) ? source.botIds.filter((id) => typeof id === 'string') : []
  return {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : newId('rnd'),
    source: typeof source.source === 'string' ? source.source : 'human',
    status: ['queued', 'running', 'done', 'failed', 'blocked'].includes(source.status) ? source.status : 'queued',
    activeBotId: typeof source.activeBotId === 'string' ? source.activeBotId : null,
    botIds,
    queue: Array.isArray(source.queue) ? source.queue.filter((id) => typeof id === 'string') : [],
    turns: Array.isArray(source.turns) ? source.turns : [],
    startedAt: typeof source.startedAt === 'string' ? source.startedAt : nowIso(),
    finishedAt: typeof source.finishedAt === 'string' ? source.finishedAt : null,
    error: typeof source.error === 'string' ? source.error : undefined,
  }
}

export function normalizeGroup(input, options = {}) {
  const id = typeof input.id === 'string' && input.id.length > 0 ? input.id : newId('grp')
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`非法群 ID：${id}`)
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : nowIso()
  const members = Array.isArray(input.members) ? input.members.map(normalizeMember) : []
  const seen = new Set()
  const unique = members.filter((m) => (seen.has(m.botId) ? false : (seen.add(m.botId), true)))
  const messages = Array.isArray(input.messages) ? input.messages.map(normalizeMessage) : []
  const kept = messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages
  const lead = typeof input.leadBotId === 'string' ? input.leadBotId : unique.length > 0 ? unique[0].botId : null
  const maxRounds = Number.isFinite(input.maxRounds) ? Math.min(12, Math.max(1, Math.round(input.maxRounds))) : 3
  return {
    id,
    kind: GROUP_KINDS.includes(input.kind) ? input.kind : 'group',
    name: asName(input.name),
    topic: clampText(input.topic ?? '', 400),
    avatar: typeof input.avatar === 'string' ? input.avatar : '',
    mode: GROUP_MODES.includes(input.mode) ? input.mode : 'mentions',
    members: unique,
    leadBotId: lead && unique.some((m) => m.botId === lead) ? lead : unique.length > 0 ? unique[0].botId : null,
    messages: kept,
    rounds: Array.isArray(input.rounds) ? input.rounds.map(normalizeRound).slice(-50) : [],
    goal: typeof input.goal === 'string' ? clampText(input.goal, 2000) : '',
    goalStatus: ['active', 'done', 'paused'].includes(input.goalStatus) ? input.goalStatus : 'paused',
    maxRounds,
    createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : createdAt,
    archived: input.archived === true,
    unread: Number.isFinite(input.unread) ? Math.max(0, Math.round(input.unread)) : 0,
    stats: {
      messages: kept.filter((m) => m.role !== 'system').length,
      botMessages: kept.filter((m) => m.role === 'bot').length,
      costCny: kept.reduce((sum, m) => sum + (Number.isFinite(m.costCny) ? m.costCny : 0), 0),
    },
    homeDir: options.homeDir,
  }
}

/** 群成员的最新发言点、人类最后一条消息等派生信息。 */
export function lastSpeaker(group) {
  for (let i = group.messages.length - 1; i >= 0; i -= 1) {
    const msg = group.messages[i]
    if (msg.role === 'bot' && msg.botId) return msg.botId
  }
  return null
}

export function lastHumanMessage(group) {
  for (let i = group.messages.length - 1; i >= 0; i -= 1) {
    if (group.messages[i].role === 'human') return group.messages[i]
  }
  return null
}

/**
 * 路由：根据群模式 + 人类消息里的 @，决定这一轮由哪些成员依次发言。
 * 返回 botId 数组（最多 groups.maxRounds 个，已去重）。
 */
export function routeTurn(group, humanText) {
  const members = group.members.map((m) => m.botId)
  const mentioned = parseMentions(humanText, group.members)
  const lead = group.leadBotId
  let queue = []

  if (group.mode === 'moderated') {
    if (lead) queue.push(lead)
    for (const id of mentioned) if (!queue.includes(id)) queue.push(id)
    if (queue.length === 0) queue = members.slice(0, 1)
  } else if (group.mode === 'round-robin') {
    const start = lastSpeaker(group)
    const index = start ? members.indexOf(start) : -1
    const ordered = index >= 0 ? members.slice(index + 1).concat(members.slice(0, index + 1)) : members.slice()
    queue = ordered.length > 0 ? [ordered[0]] : []
    for (const id of mentioned) if (!queue.includes(id)) queue.push(id)
  } else if (group.mode === 'panel') {
    queue = members.slice()
  } else {
    // mentions（默认）：有人被 @ 就交给他们，否则交给主持人
    queue = mentioned.length > 0 ? mentioned.slice() : lead ? [lead] : members.slice(0, 1)
  }

  const limit = Math.max(1, Math.min(12, group.maxRounds || 3))
  return queue.filter((id) => members.includes(id)).slice(0, limit)
}

/** 机器人回复里的 @ → 下一棒。 */
export function routeHandoff(group, text, excludeBotId) {
  const members = group.members.map((m) => m.botId)
  return parseMentions(text, group.members).filter((id) => id !== excludeBotId && members.includes(id))
}

export function buildGroupTaskPrompt(group, triggerMessage, speaker) {
  const lines = []
  const mate = group.members.map((m) => `- ${m.name}（${m.botId}）${m.botId === speaker.botId ? ' ← 这是你' : ''}`).join('\n')
  lines.push('你正在参加一个 DSH Bot 群聊（类似 Grok Bot 的 Bot 之间互相拉群）。')
  lines.push('')
  lines.push(`群名：${group.name}${group.topic ? `｜主题：${group.topic}` : ''}`)
  if (group.goal) lines.push(`群目标：${group.goal}（状态：${group.goalStatus}）`)
  lines.push('群成员：')
  lines.push(mate)
  if (group.leadBotId === speaker.botId) lines.push(`群里的主持人是你。`)
  lines.push('')
  const recent = group.messages.slice(-14)
  lines.push('最近的群聊记录（从旧到新）：')
  for (const msg of recent) {
    const who = msg.role === 'human' ? '人类' : msg.role === 'system' ? '系统' : `${msg.name || msg.botId}`
    const text = clampText(msg.text, 1200)
    if (!text) continue
    lines.push(`[${who}] ${text}`)
  }
  lines.push('')
  if (triggerMessage) {
    const who = triggerMessage.role === 'human' ? '人类' : `${triggerMessage.name || triggerMessage.botId}`
    lines.push(`现在轮到你说下一句。刚刚 ${who} 说：`)
    lines.push(clampText(triggerMessage.text, 4000))
  } else {
    lines.push('现在轮到你发言。')
  }
  lines.push('')
  lines.push('群聊规范：')
  lines.push('- 直接输出你要发到群里的话，不要写旁白、不要复述规则、不要输出 Markdown 代码块外的解释。')
  lines.push('- 想点名让某位成员接着做，在正文里用 @成员名 或 @成员ID（例如 @' + (group.members.find((m) => m.botId !== speaker.botId)?.name || '成员') + '）。')
  lines.push('- 一句话能说清就不要写长文；需要交付物时再动手。')
  lines.push('- 如果这个问题不适合你回答，用一句 @合适的成员名 把球传出去。')
  return lines.join('\n')
}

export class GroupStore {
  constructor(homeDir, options = {}) {
    this.homeDir = expandHome(homeDir || '~/.dsh/bot')
    this.dir = path.join(this.homeDir, 'groups')
    this.maxMessages = Number.isFinite(options.maxMessages) ? options.maxMessages : MAX_MESSAGES
    this._locks = new Map()
  }

  groupPath(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`非法群 ID：${String(id)}`)
    }
    return path.join(this.dir, `${id}.json`)
  }

  async ensureDir() {
    await fsp.mkdir(this.dir, { recursive: true })
  }

  async save(group) {
    await this.ensureDir()
    const normalized = normalizeGroup(group, { homeDir: this.homeDir })
    const file = this.groupPath(normalized.id)
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temp, JSON.stringify(normalized, null, 2), 'utf8')
    await fsp.rename(temp, file)
    return normalized
  }

  async get(id) {
    try {
      const raw = await fsp.readFile(this.groupPath(id), 'utf8')
      return normalizeGroup(JSON.parse(raw), { homeDir: this.homeDir })
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async list() {
    await this.ensureDir()
    let names = []
    try {
      names = await fsp.readdir(this.dir)
    } catch {
      return []
    }
    const groups = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = await fsp.readFile(path.join(this.dir, name), 'utf8')
        const parsed = normalizeGroup(JSON.parse(raw), { homeDir: this.homeDir })
        groups.push(parsed)
      } catch {
        // 坏文件跳过，不阻塞其它群
      }
    }
    groups.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return groups
  }

  async remove(id) {
    try {
      await fsp.unlink(this.groupPath(id))
      return true
    } catch (error) {
      if (error && error.code === 'ENOENT') return false
      throw error
    }
  }

  async withLock(id, work) {
    const key = String(id)
    const previous = this._locks.get(key) || Promise.resolve()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => gate)
    this._locks.set(key, chained)
    try {
      await previous
      return await work()
    } finally {
      release()
      if (this._locks.get(key) === chained) this._locks.delete(key)
    }
  }

  /** 读-改-写，避免并发写覆盖；mutator 可返回 null 表示不保存。 */
  async mutate(id, mutator) {
    return this.withLock(id, async () => {
      const group = await this.get(id)
      if (!group) return null
      const next = await mutator(group)
      if (next === null) return null
      const target = next || group
      target.updatedAt = nowIso()
      return this.save(target)
    })
  }

  async appendMessage(id, message) {
    return this.mutate(id, (group) => {
      const msg = normalizeMessage({ ...message, at: message.at || nowIso() })
      group.messages = [...group.messages, msg].slice(-this.maxMessages)
      group.updatedAt = nowIso()
      if (msg.role === 'bot' || msg.role === 'human') {
        group.stats = {
          messages: group.messages.filter((m) => m.role !== 'system').length,
          botMessages: group.messages.filter((m) => m.role === 'bot').length,
          costCny: group.messages.reduce((sum, m) => sum + (Number.isFinite(m.costCny) ? m.costCny : 0), 0),
        }
      }
      return group
    })
  }

  async appendRound(id, round) {
    const normalized = normalizeRound(round)
    await this.mutate(id, (group) => {
      group.rounds = [...(group.rounds || []), normalized].slice(-50)
      group.unread = Number(group.unread || 0) + 1
      return group
    })
    return normalized
  }

  async patchRound(id, roundId, patch) {
    return this.mutate(id, (group) => {
      group.rounds = (group.rounds || []).map((round) =>
        round && round.id === roundId ? { ...round, ...patch } : round,
      )
      return group
    })
  }

  async patchMessage(id, messageId, patch) {
    return this.mutate(id, (group) => {
      const index = group.messages.findIndex((m) => m.id === messageId)
      if (index < 0) return group
      const merged = { ...group.messages[index], ...patch }
      group.messages = group.messages.map((m) => (m.id === messageId ? merged : m))
      group.stats = {
        messages: group.messages.filter((m) => m.role !== 'system').length,
        botMessages: group.messages.filter((m) => m.role === 'bot').length,
        costCny: group.messages.reduce((sum, m) => sum + (Number.isFinite(m.costCny) ? m.costCny : 0), 0),
      }
      return group
    })
  }
}

export function fileExistsSync(file) {
  try {
    fs.accessSync(file, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}
