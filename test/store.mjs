// 冒烟测试：不依赖 DSH 运行时，直接导入插件自身模块并跑一遍纯逻辑。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../lib/', import.meta.url)
const store = await import(new URL('store.js', root).href)
const host = await import(new URL('index.js', root).href)
const toolsMod = await import(new URL('tools.js', root).href)

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

const home = mkdtempSync(join(tmpdir(), 'bgx-'))
const groups = new store.GroupStore(home)

const members = [
  { botId: 'bot_alpha', name: 'Alpha', role: '研究员' },
  { botId: 'bot_beta', name: 'Beta', role: '工程师' },
  { botId: 'bot_gamma', name: 'Gamma', role: '评审' },
]

await check('parseMentions 精确匹配', () => {
  const hits = store.parseMentions('请 @Beta 看看，再让 @Alpha 复核 @bot_gamma', members)
  return hits.length === 3 && hits[0] === 'bot_beta'
})

await check('parseMentions 不误匹配前缀', () => store.parseMentions('@Betamax 与 @Alpha2', members).length === 0)

await check('stripMentions', () => store.stripMentions('@Beta 你好', members).trim() === '你好')

const group = store.normalizeGroup({
  id: 'grp_test',
  kind: 'group',
  name: '发布评审',
  topic: '决定 0.2 是否发版',
  members,
  mode: 'mentions',
  maxRounds: 4,
  goal: '今天给出结论',
})

await check('normalizeGroup 默认值', () => group.leadBotId === 'bot_alpha' && group.messages.length === 0 && group.stats.messages === 0)
await check('normalizeGroup 拒绝非法 id', () => {
  try {
    store.normalizeGroup({ id: '../evil', name: 'x', members })
    return false
  } catch (error) {
    return /id/i.test(String(error.message || error))
  }
})

await groups.save(group)
await check('save/get 往返', async () => (await groups.get('grp_test')).name === '发布评审')

await groups.appendMessage('grp_test', { role: 'human', text: '大家看下能不能发', kind: 'message' })
await check('appendMessage 统计', async () => (await groups.get('grp_test')).stats.messages === 1)

const afterHuman = await groups.get('grp_test')
const queued = store.routeTurn(afterHuman, '大家看下能不能发')
await check('routeTurn mentions 无 @ 时由 lead 发言', () => queued.length === 1 && queued[0] === 'bot_alpha')

const ping = await groups.get('grp_test')
ping.mode = 'mentions'
await groups.save(ping)

await check('routeTurn 有 @ 时点名', async () => {
  const next = store.routeTurn(await groups.get('grp_test'), '@Gamma 你先说')
  return next.length === 1 && next[0] === 'bot_gamma'
})

await check('routeTurn round-robin 一次一位', async () => {
  const g = await groups.get('grp_test')
  const next = store.routeTurn({ ...g, mode: 'round-robin', maxRounds: 2 }, '继续')
  return next.length === 1
})

await check('routeTurn panel 全员', async () => {
  const g = await groups.get('grp_test')
  return store.routeTurn({ ...g, mode: 'panel', maxRounds: 4 }, '圆桌').length === 3
})

await check('routeTurn moderated 主持人优先', async () => {
  const g = await groups.get('grp_test')
  const next = store.routeTurn({ ...g, mode: 'moderated', leadBotId: 'bot_beta' }, '开始')
  return next[0] === 'bot_beta'
})

await check('routeHandoff 排除自己', async () => {
  const g = await groups.get('grp_test')
  return store.routeHandoff(g, '接下来 @Alpha 接手', 'bot_alpha').length === 0
})

const round = await groups.appendRound('grp_test', { source: 'human', botIds: ['bot_alpha'], turns: [] })
await check('appendRound + unread', async () => {
  const g = await groups.get('grp_test')
  return g.unread === 1 && round && round.id && g.rounds.length === 1
})

await groups.patchRound('grp_test', round.id, { status: 'done', finishedAt: store.nowIso() })
await check('patchRound', async () => (await groups.get('grp_test')).rounds[0].status === 'done')

const firstMessage = (await groups.get('grp_test')).messages[0]
await groups.patchMessage('grp_test', firstMessage.id, { status: 'done', costCny: 0.01 })
await check('patchMessage 花费累计', async () => Math.abs((await groups.get('grp_test')).stats.costCny - 0.01) < 1e-9)

await check('buildGroupTaskPrompt 含关键段', async () => {
  const g = await groups.get('grp_test')
  const text = store.buildGroupTaskPrompt(g, g.messages[0], { botId: 'bot_alpha', name: 'Alpha' })
  return text.includes('发布评审') && text.includes('Alpha') && text.includes('@') && text.includes('这是你')
})

await check('GroupStore.list', async () => {
  const list = await groups.list()
  return list.length === 1 && list[0].id === 'grp_test'
})

await check('mutate 并发安全', async () => {
  await Promise.all([
    groups.appendMessage('grp_test', { role: 'human', text: '并发 1' }),
    groups.appendMessage('grp_test', { role: 'human', text: '并发 2' }),
    groups.appendMessage('grp_test', { role: 'human', text: '并发 3' }),
  ])
  const g = await groups.get('grp_test')
  return g.messages.length === 4
})

await check('remove', async () => {
  const removed = await groups.remove('grp_test')
  const after = await groups.get('grp_test')
  return removed === true && after === null
})

await check('index.js 导出 apply/name/inject', () => {
  return typeof host.default.apply === 'function' && host.default.name === 'dsh-bot-groups' && Array.isArray(host.default.inject)
})

await check('tools.js 导出注册函数', () => typeof toolsMod.registerBotGroupTools === 'function')

await check('工具注册（假 ctx）', () => {
  const names = []
  const fakeCtx = { tools: { register: (def) => names.push(def.name) } }
  const fakeService = { list: async () => [], get: async () => null }
  toolsMod.registerBotGroupTools(fakeCtx, fakeService, { warn() {}, info() {} })
  const expected = [
    'bot_group_list', 'bot_group_create', 'bot_group_show', 'bot_group_chat',
    'bot_group_round', 'bot_group_speak', 'bot_group_invite', 'bot_group_remove_members',
    'bot_group_goal', 'bot_group_mode', 'bot_group_delete',
    'bot_group_stop', 'bot_group_retry', 'bot_group_task', 'bot_group_budget',
    'bot_group_model', 'bot_providers',
  ]
  return expected.every((n) => names.includes(n)) && names.length === expected.length
})

rmSync(home, { recursive: true, force: true })

if (failures.length > 0) {
  console.error('\n失败：')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log('\n全部通过')
