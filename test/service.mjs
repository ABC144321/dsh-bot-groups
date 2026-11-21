// 集成测试：用假 ctx 走一遍 apply() + GroupService（不加载真实 dsh-bot、不写真实 home）。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const host = await import(new URL('../lib/index.js', import.meta.url).href)

const failures = []
async function check(label, fn) {
  try {
    const value = await fn()
    if (value === false || value === undefined || value === null) {
      failures.push(`${label}: 返回 ${String(value)}`)
      console.log(`FAIL ${label}`)
    } else {
      console.log(`ok   ${label}`)
    }
  } catch (error) {
    failures.push(`${label}: ${error && error.stack ? error.stack : error}`)
    console.log(`FAIL ${label}`)
  }
}

const home = mkdtempSync(join(tmpdir(), 'bgx-svc-'))
const routes = []
const toolNames = []
let service = null
const ctx = {
  logger: { info() {}, warn() {}, debug() {} },
  tools: {
    register(def) {
      toolNames.push(def.name)
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect(factory) {
    const dispose = typeof factory === 'function' ? factory() : undefined
    return Array.isArray(dispose) ? dispose : () => {}
  },
  get() {
    return undefined
  },
  set(name, value) {
    if (name === 'botGroups') service = value
  },
}

await host.apply(ctx, { homeDir: home, replyDryRun: false, handoffEnabled: true, maxBotsPerRound: 3 })

const bots = [
  { id: 'bot_alpha', name: 'Alpha', role: '研究员' },
  { id: 'bot_beta', name: 'Beta', role: '工程师' },
  { id: 'bot_gamma', name: 'Gamma', role: '评审' },
]

// 假 Bot 运行时
let runs = 0
const fakeRunner = {
  async runTask(botId, task, flags, signal) {
    runs += 1
    if (signal && signal.aborted) throw new Error('aborted')
    const target = botId === 'bot_alpha' ? '@Beta 你来接手' : '收到，我补充一句。'
    return {
      id: `run_${runs}`,
      botId,
      dryRun: flags && flags.dryRun === true,
      status: 'success',
      usage: { costCny: 0.02 },
      steps: [{ index: 0, kind: 'llm', name: 'model', result: { output: target } }],
    }
  },
}

await check('apply() 注册前缀路由', () => routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/_dsh-bot-groups')
await check('apply() 注册 17 个工具', () => toolNames.length === 17)
await check('ctx.set("botGroups") 生效', () => service && typeof service.create === 'function')

// 注入假 Bot 身份与运行时
service.bots.listBots = async () => bots
service.bots.getBot = async (id) => bots.find((b) => b.id === id) || null
service.bots.runtime = async () => ({ runner: fakeRunner, label: 'fake', module: 'fake', degraded: false, homeDir: home })

let groupId = ''
await check('create() 拉群', async () => {
  const group = await service.create({
    kind: 'group',
    name: '发布评审',
    topic: '0.2 能不能发',
    goal: '今天给出结论',
    members: ['bot_alpha', 'bot_beta', 'bot_gamma'],
    mode: 'mentions',
    maxRounds: 3,
  })
  groupId = group.id
  return group.members.length === 3 && group.leadBotId === 'bot_alpha' && group.messages.length === 2
})

await check('list() 摘要', async () => {
  const list = await service.list()
  return list.length === 1 && list[0].members.every((m) => m.alive === true) && list[0].stats.botMessages === 0 && list[0].members.length === 3
})

await check('postHuman(reply) 触发接力并 @ 交接', async () => {
  const result = await service.postHuman(groupId, '大家看下能不能发', { reply: true })
  await service.waitIdle(groupId, 60000)
  const detail = await service.detail(groupId)
  const botMessages = detail.messages.filter((m) => m.role === 'bot' && m.status === 'done')
  const alphaThenBeta = botMessages.length >= 2 && botMessages[0].botId === 'bot_alpha' && botMessages[1].botId === 'bot_beta'
  const costOk = Math.abs(detail.stats.costCny - 0.04) < 1e-9
  const roundDone = detail.rounds.some((r) => r.status === 'done' && r.finishedAt)
  return result.queued.length >= 1 && alphaThenBeta && costOk && roundDone
})

await check('postHuman(reply:false) 不触发接力', async () => {
  const result = await service.postHuman(groupId, '先记一笔', { reply: false })
  return result.queued.length === 0
})

await check('更新模式与目标', async () => {
  const group = await service.update(groupId, { mode: 'panel', goalStatus: 'active', maxRounds: 2, topic: '新主题' })
  return group.mode === 'panel' && group.goalStatus === 'active' && group.maxRounds === 2
})

await check('panel 模式全员圆桌（上限 2）', async () => {
  const before = (await service.detail(groupId)).messages.filter((m) => m.role === 'bot').length
  await service.startRound(groupId, {})
  await service.waitIdle(groupId, 60000)
  const detail = await service.detail(groupId)
  const after = detail.messages.filter((m) => m.role === 'bot').length
  return after - before === 2
})

await check('invite()', async () => {
  const group = await service.invite(groupId, ['bot_gamma'])
  return group.members.length === 3
})

await check('removeMembers()', async () => {
  const group = await service.removeMembers(groupId, ['bot_gamma'])
  return group.members.length === 2
})

await check('removeMembers() 拒绝清空', async () => {
  try {
    await service.removeMembers(groupId, ['bot_alpha', 'bot_beta'])
    return false
  } catch (error) {
    return error.code === 'INVALID_ARGS'
  }
})

await check('botSpeak() 主动发言 + 交接', async () => {
  const result = await service.botSpeak(groupId, 'bot_beta', '我这边 OK，@Alpha 你确认下文案。')
  await service.waitIdle(groupId, 60000)
  return result.handoff.includes('bot_alpha')
})

await check('diag()', async () => {
  const diag = await service.diag()
  return diag.groupCount === 1 && diag.dryRun === false && typeof diag.degraded === 'boolean' && diag.homeDir === home
})

// 走一遍 HTTP handler
function call(method, path, body) {
  return new Promise((resolve) => {
    const chunks = []
    const req = {
      method,
      url: path,
      headers: { host: '127.0.0.1:52699', origin: 'http://127.0.0.1:52699', 'content-type': 'application/json' },
      on(event, fn) {
        if (event === 'data' && body !== undefined) fn(Buffer.from(JSON.stringify(body)))
        if (event === 'end') fn()
        if (event === 'error') fn()
        return req
      },
      destroy() {},
    }
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(k, v) {
        this.headers[k] = v
      },
      writeHead(status, headers) {
        this.statusCode = status
        Object.assign(this.headers, headers || {})
        return this
      },
      end(chunk) {
        if (chunk) this.body += String(chunk)
        resolve({ status: this.statusCode, headers: this.headers, json: this.body ? JSON.parse(this.body) : null })
      },
      getHeader(k) {
        return this.headers[k]
      },
    }
    routes[0].handler(req, res).catch((error) => resolve({ status: 0, error: String(error) }))
  })
}

await check('GET /overview', async () => {
  const res = await call('GET', '/_dsh-bot-groups/overview')
  return res.status === 200 && res.json.ok === true && Array.isArray(res.json.value.groups) && res.json.value.bots.length === 3
})

await check('GET /groups/:id', async () => {
  const res = await call('GET', `/_dsh-bot-groups/groups/${groupId}`)
  return res.status === 200 && res.json.value.group.id === groupId
})

await check('POST /groups/:id/messages', async () => {
  const res = await call('POST', `/_dsh-bot-groups/groups/${groupId}/messages`, { text: 'HTTP 发一条', reply: false })
  return res.status === 200 && res.json.value.queued.length === 0 && res.json.value.group.messages.some((m) => m.text === 'HTTP 发一条')
})

await check('POST /groups/:id/update', async () => {
  const res = await call('POST', `/_dsh-bot-groups/groups/${groupId}/update`, { name: '改名后的群' })
  return res.status === 200 && res.json.value.group.name === '改名后的群'
})

await check('非法 JSON body → 400', async () => {
  const res = await new Promise((resolve) => {
    const req = {
      method: 'POST',
      url: `/_dsh-bot-groups/groups/${groupId}/messages`,
      headers: { host: '127.0.0.1:52699', origin: 'http://127.0.0.1:52699' },
      on(event, fn) {
        if (event === 'data') fn(Buffer.from('{oops'))
        if (event === 'end') fn()
        return req
      },
      destroy() {},
    }
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(s) { this.statusCode = s; return this },
      setHeader() {},
      end(chunk) { resolve({ status: this.statusCode, json: chunk ? JSON.parse(String(chunk)) : null }) },
      getHeader() {},
    }
    routes[0].handler(req, res)
  })
  return res.status === 400 && res.json.code === 'INVALID_ARGS'
})

await check('非本机 Origin → 403', async () => {
  const res = await new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: '/_dsh-bot-groups/overview',
      headers: { host: 'evil.example.com', origin: 'http://evil.example.com' },
      on() { return req },
      destroy() {},
    }
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(s) { this.statusCode = s; return this },
      setHeader() {},
      end(chunk) { resolve({ status: this.statusCode, json: chunk ? JSON.parse(String(chunk)) : null }) },
      getHeader() {},
    }
    routes[0].handler(req, res)
  })
  return res.status === 403 && res.json.code === 'FORBIDDEN'
})

await check('GET /diag', async () => {
  const res = await call('GET', '/_dsh-bot-groups/diag')
  return res.status === 200 && res.json.value.homeDir === home && res.json.value.degraded === false
})

await check('DELETE /groups/:id', async () => {
  const res = await call('DELETE', `/_dsh-bot-groups/groups/${groupId}`)
  const after = await call('GET', `/_dsh-bot-groups/groups/${groupId}`)
  return res.status === 200 && after.status === 404
})

rmSync(home, { recursive: true, force: true })

if (failures.length > 0) {
  console.error('\n失败：')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log('\n全部通过')
