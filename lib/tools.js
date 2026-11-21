/**
 * dsh-bot-groups · 工具面
 *
 * 这些工具让「Bot 模式」里的助手可以把多个 Bot 拉进一个群、安排接力发言、
 * 维护群目标，也可以用 @ 把球传给下一位成员。
 *
 * 这里刻意不使用 @deepseek-ai/dsh-tools 的 defineTool：工具定义就是普通的
 * JSON Schema 对象，避免在非 Host 环境里多一条运行时依赖。
 */

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
}

function tool(name, description, properties, required, execute, extra = {}) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args) {
      return execute(args || {})
    },
    ...extra,
  }
}

function str(description, extra = {}) {
  return { type: 'string', description, ...extra }
}

function bool(description, extra = {}) {
  return { type: 'boolean', description, ...extra }
}

function num(description, extra = {}) {
  return { type: 'number', description, ...extra }
}

function arr(description, items = { type: 'string' }) {
  return { type: 'array', description, items }
}

function modeText(mode) {
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

function fmtGroup(group) {
  const members = (group.members || []).map((member) => member.name || member.botId).join('、')
  const lines = []
  lines.push(`群：${group.name}（${group.id}）`)
  lines.push(`模式：${modeText(group.mode)}｜每轮最多 ${group.maxRounds} 位`)
  lines.push(`成员：${members}${group.leadBotId ? `｜主持人：${group.leadBotId}` : ''}`)
  if (group.goal) lines.push(`目标：${group.goal}（${group.goalStatus}）`)
  if (group.topic) lines.push(`主题：${group.topic}`)
  lines.push(`消息数：${group.stats?.messages ?? 0}｜累计花费：¥${(group.stats?.costCny ?? 0).toFixed(4)}`)
  if (group.lastMessage) {
    lines.push(`最后一条：${group.lastMessage.name} — ${String(group.lastMessage.text || '').slice(0, 80)}`)
  }
  return lines.join('\n')
}

function fmtMessages(messages, limit = 20) {
  const rows = messages.slice(-limit)
  if (rows.length === 0) return '（还没有消息）'
  return rows
    .map((msg) => {
      const who = msg.role === 'human' ? '人类' : msg.role === 'system' ? '系统' : msg.name || msg.botId
      const status = msg.status && msg.status !== 'done' ? ` [${msg.status}]` : ''
      return `[${who}]${status} ${String(msg.text || '').replace(/\n/g, ' ⏎ ')}`
    })
    .join('\n')
}

/**
 * 注册群聊工具。
 * @param ctx 宿主上下文（需要 ctx.tools）
 * @param service GroupService
 * @param logger 可选日志器
 */
export function registerBotGroupTools(ctx, service, logger) {
  const tools = [
    tool(
      'bot_group_list',
      '列出所有 Bot 群（类似 Grok Bot 的 Bot 群列表）：成员、模式、目标、最近一条消息。',
      { includeArchived: bool('是否包含已归档的群，默认 false') },
      [],
      async (args) => {
        const groups = await service.list()
        const rows = groups.filter((group) => (args.includeArchived ? true : !group.archived))
        if (rows.length === 0) return '当前还没有 Bot 群。用 bot_group_create 拉一个群。'
        return rows.map(fmtGroup).join('\n\n')
      },
    ),
    tool(
      'bot_group_create',
      '拉一个 Bot 群：把多个已存在的 Bot 拉进来，可设置主题、群目标、路由模式与主持人。',
      {
        name: str('群名，例如「上线评审小组」'),
        members: arr('成员：Bot 名称或 bot_xxx ID 的数组（至少一位）'),
        topic: str('群主题（可选）'),
        goal: str('群目标（可选）；设置后会作为群上下文注入每次发言'),
        mode: str('路由模式：mentions（默认，@ 谁谁答）/ round-robin / panel / moderated'),
        leadBotId: str('主持人 Bot 名称或 ID（可选，默认第一位成员）'),
        maxRounds: num('每轮最多几位成员接力发言（1-12，默认 3）'),
        kind: str('group（群聊，默认）或 dm（和单个 Bot 的私聊）'),
      },
      ['name', 'members'],
      async (args) => {
        const detail = await service.create({
          name: args.name,
          members: args.members,
          topic: args.topic,
          goal: args.goal,
          mode: args.mode,
          leadBotId: args.leadBotId,
          maxRounds: args.maxRounds,
          kind: args.kind,
        })
        return `已创建。\n${fmtGroup(detail)}`
      },
    ),
    tool(
      'bot_group_show',
      '查看某个 Bot 群的详情与最近消息（用于接手上下文）。',
      { groupId: str('群 ID（grp_xxx）或群名'), limit: num('返回最近多少条消息，默认 20') },
      ['groupId'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        return `${fmtGroup(group)}\n\n最近消息：\n${fmtMessages(group.messages || [], args.limit || 20)}`
      },
    ),
    tool(
      'bot_group_chat',
      '在 Bot 群里发一条消息；默认会让群成员按模式自动接力回复（可用 dryRun/不回复控制）。',
      {
        groupId: str('群 ID 或群名'),
        text: str('要发到群里的话'),
        reply: bool('是否让 Bot 自动接力回复，默认 true'),
        wait: bool('是否等到本轮发言结束再返回，默认 true'),
        dryRun: bool('演练：只生成不落副作用（由 Bot 运行时决定），默认 false'),
      },
      ['groupId', 'text'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const result = await service.postHuman(group.id, args.text, { reply: args.reply !== false })
        let out = `已发送到「${group.name}」。`
        if ((result.queued || []).length > 0) {
          const names = result.queued.map((botId) => result.group.members.find((m) => m.botId === botId)?.name || botId)
          out += `\n排队发言：${names.join(' → ')}`
          if (args.wait !== false) {
            await service.waitIdle(group.id, service.config.runTimeoutMs * Math.max(1, result.queued.length))
            const latest = await service.detail(group.id)
            const replies = (latest.messages || []).filter(
              (msg) => msg.role === 'bot' && (result.queued || []).includes(msg.botId),
            )
            out += `\n\n本轮回复：\n${fmtMessages(replies.slice(-Math.max(1, result.queued.length)), 12)}`
          }
        } else {
          out += '\n（本群当前模式不会自动回复；可用 bot_group_round 手动点名。）'
        }
        return out
      },
    ),
    tool(
      'bot_group_round',
      '让群成员依次发言一轮（圆桌讨论）。不传 botIds 时由群模式决定顺序。',
      {
        groupId: str('群 ID 或群名'),
        botIds: arr('指定发言顺序（Bot 名称或 ID），可选'),
        wait: bool('是否等本轮结束再返回，默认 true'),
      },
      ['groupId'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const result = await service.startRound(group.id, { botIds: args.botIds, source: 'panel' })
        if (args.wait === false) return `已启动圆桌（round ${result.roundId}），成员依次发言中。`
        await service.waitIdle(group.id, service.config.runTimeoutMs * Math.max(1, result.queue.length))
        const latest = await service.detail(group.id)
        const replies = (latest.messages || []).filter((msg) => msg.role === 'bot').slice(-result.queue.length)
        return `圆桌结束。\n\n${fmtMessages(replies, 12)}`
      },
    ),
    tool(
      'bot_group_speak',
      '以指定成员的口气发一条群消息（不需要真的跑模型）。适合把已有结论投递到群里。',
      {
        groupId: str('群 ID 或群名'),
        botId: str('发言的成员（Bot 名称或 ID）'),
        text: str('发言内容'),
      },
      ['groupId', 'botId', 'text'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const result = await service.botSpeak(group.id, args.botId, args.text)
        const handoff = (result.handoff || []).map(
          (botId) => result.group.members.find((m) => m.botId === botId)?.name || botId,
        )
        return handoff.length > 0 ? `已发言，并把球传给了：${handoff.join('、')}` : '已发言。'
      },
    ),
    tool(
      'bot_group_invite',
      '把更多 Bot 拉进已有的群。',
      { groupId: str('群 ID 或群名'), members: arr('要加入的 Bot 名称或 ID') },
      ['groupId', 'members'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const detail = await service.invite(group.id, args.members)
        return `已更新成员。\n${fmtGroup(detail)}`
      },
    ),
    tool(
      'bot_group_remove_members',
      '把成员移出群（至少保留一位；要解散请用 bot_group_delete）。',
      { groupId: str('群 ID 或群名'), botIds: arr('要移出的 Bot 名称或 ID') },
      ['groupId', 'botIds'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const detail = await service.removeMembers(group.id, args.botIds)
        return `已更新成员。\n${fmtGroup(detail)}`
      },
    ),
    tool(
      'bot_group_goal',
      '设置 / 更新 / 完成群目标（会注入到每次群发言的上下文里）。',
      {
        groupId: str('群 ID 或群名'),
        goal: str('目标描述；空字符串表示清空'),
        status: str('active / paused / done（默认 active）'),
      },
      ['groupId'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const detail = await service.update(group.id, {
          goal: args.goal ?? group.goal,
          goalStatus: args.status ?? 'active',
        })
        return `群目标已更新。\n${fmtGroup(detail)}`
      },
    ),
    tool(
      'bot_group_mode',
      '切换群的路由模式与每轮接力人数。',
      {
        groupId: str('群 ID 或群名'),
        mode: str('mentions / round-robin / panel / moderated'),
        maxRounds: num('每轮最多几位成员接力（1-12）'),
        leadBotId: str('主持人 Bot 名称或 ID'),
      },
      ['groupId'],
      async (args) => {
        const group = await resolveGroup(service, args.groupId)
        const detail = await service.update(group.id, {
          mode: args.mode,
          maxRounds: args.maxRounds,
          leadBotId: args.leadBotId,
        })
        return `已切换。\n${fmtGroup(detail)}`
      },
    ),
    tool(
      'bot_group_delete',
      '解散并删除一个 Bot 群（不可恢复）。',
      { groupId: str('群 ID 或群名'), confirm: bool('必须显式传 true') },
      ['groupId', 'confirm'],
      async (args) => {
        if (args.confirm !== true) throw Object.assign(new Error('删除群需要 confirm: true'), { code: 'INVALID_ARGS' })
        const group = await resolveGroup(service, args.groupId)
        await service.remove(group.id)
        return `已解散「${group.name}」。`
      },
    ),
  ]

  let registered = 0
  for (const definition of tools) {
    try {
      ctx.tools.register(definition)
      registered += 1
    } catch (error) {
      logger?.warn?.(`dsh-bot-groups: 注册工具 ${definition.name} 失败：${String(error?.message || error)}`)
    }
  }
  return registered
}

async function resolveGroup(service, ref) {
  const key = String(ref || '').trim()
  if (!key) throw Object.assign(new Error('缺少群 ID'), { code: 'INVALID_ARGS' })
  const groups = await service.store.list()
  const hit = groups.find((group) => group.id === key || group.name === key)
  if (!hit) {
    throw Object.assign(new Error(`找不到群：${key}。可以用 bot_group_list 查看现有群。`), {
      code: 'GROUP_NOT_FOUND',
    })
  }
  return hit
}

export default { registerBotGroupTools }
