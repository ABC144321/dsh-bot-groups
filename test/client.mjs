/**
 * dsh-bot-groups · 客户端 bundle 自测
 *
 * 没有真实 React 可导入（app.asar 里不带 react），所以这里用一个最小 React 替身：
 * createElement + 只跑一遍的 hooks + 递归渲染器，把组件树渲染成文本，
 * 用真实组件代码检查 JSX 结构、hooks 调用顺序与文本输出。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let failures = 0
async function check(label, fn) {
  try {
    const result = await fn()
    if (result === false) throw new Error('返回 false')
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label}\n       ${error && error.message ? error.message : error}`)
  }
}

/* ------------------------------ 最小 React ------------------------------ */
let hookCtx = null

function createElement(type, props, ...children) {
  const merged = { ...(props || {}) }
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  return { $$el: true, type, props: merged }
}

function useState(initial) {
  const index = hookCtx.index++
  const slot = hookCtx.slots[index]
  if (slot === undefined) hookCtx.slots[index] = initial
  const value = hookCtx.slots[index]
  return [value, () => {}]
}
function useEffect() {}
function useRef(initial) {
  const index = hookCtx.index++
  if (hookCtx.slots[index] === undefined) hookCtx.slots[index] = { current: initial }
  return hookCtx.slots[index]
}
function useCallback(fn) {
  hookCtx.index++
  return fn
}
function useMemo(fn) {
  hookCtx.index++
  return fn()
}

class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }
  setState() {}
}

const Fragment = Symbol('Fragment')
const fakeReact = {
  createElement,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Component,
  Fragment,
}

/* ------------------------------- 假浏览器 ------------------------------- */
const styleNodes = []
const loaderCalls = []

globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      loaderCalls.push(def)
    },
  },
  confirm: () => false,
}
globalThis.document = {
  getElementById: () => null,
  createElement: (tag) => {
    const node = { tag, style: {}, children: [] }
    styleNodes.push(node)
    return node
  },
  head: { appendChild() {} },
}
const consoleErrors = []
const originError = console.error
console.error = (...args) => {
  consoleErrors.push(args.map((a) => (a && a.message) || String(a)).join(' '))
}

/* 执行 bundle（IIFE + __ModuleLoader__.load） */
new Function('window', 'document', 'console', 'setInterval', 'clearInterval', source)(
  globalThis.window,
  globalThis.document,
  console,
  () => 0,
  () => {},
)

await check('bundle 调用了一次 __ModuleLoader__.load', () => loaderCalls.length === 1)
const def = loaderCalls[0] || {}
await check('模块 id 是 dsh-bot-groups', () => {
  if (def.id !== 'dsh-bot-groups') throw new Error(`id=${def.id}`)
  return true
})

const mod = def.factory((name) => {
  if (name === 'react') return fakeReact
  const error = new Error(`未知依赖：${name}`)
  throw error
})

await check('模块名 / inject', () => mod.name === 'dsh-bot-groups-client' && mod.inject.includes('slots') && mod.inject.includes('layout'))

/* ------------------------------- 渲染器 -------------------------------- */
function render(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const item of node) render(item, out)
    return out
  }
  if (!node.$$el) {
    out.push(String(node))
    return out
  }
  const { type, props } = node
  if (type === Fragment) return render(props.children, out)
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.isReactComponent !== false && type.prototype.render) {
      const instance = new type(props)
      instance.state = instance.state || {}
      return render(instance.render(), out)
    }
    if (type.prototype && type.prototype.render) {
      const instance = new type(props)
      instance.state = instance.state || {}
      return render(instance.render(), out)
    }
    const previous = hookCtx
    hookCtx = { slots: [], index: 0 }
    try {
      return render(type(props), out)
    } finally {
      hookCtx = previous
    }
  }
  return render(props.children, out)
}

function textOf(node) {
  return render(node).join(' ')
}

/* ------------------------------- 假 ctx -------------------------------- */
const registrations = []
const fakeCtx = {
  slots: {
    inject(slot, cb) {
      registrations.push({ slot, cb })
      return cb()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  layout: { selectPanel() {} },
}

await check('apply() 不抛错', () => {
  mod.apply(fakeCtx)
  return true
})

const slotNames = registrations.filter((r) => r.options).map((r) => r.options.name)
await check('注册了 main / dock / settings ×2 / sidebar', () => {
  const count = (name) => slotNames.filter((item) => item === name).length
  if (count('main') !== 1) throw new Error(`main=${count('main')}`)
  if (count('conversation.input.dock') !== 1) throw new Error(`dock=${count('conversation.input.dock')}`)
  if (count('settings.section') !== 2) throw new Error(`settings=${count('settings.section')}`)
  if (count('sidebar.panellist') !== 1) throw new Error(`sidebar=${count('sidebar.panellist')}`)
  return true
})
await check('main 使用 keyed key=bot-groups', () => {
  const hit = registrations.find((r) => r.options && r.options.name === 'main')
  if (!hit || hit.options.key !== 'bot-groups') throw new Error(JSON.stringify(hit && hit.options))
  return true
})
await check('dock / settings / sidebar 的 id 与 order', () => {
  const dock = registrations.find((r) => r.options && r.options.name === 'conversation.input.dock').options
  const settingsRows = registrations.filter((r) => r.options && r.options.name === 'settings.section').map((r) => r.options)
  const settings = settingsRows.find((row) => row.id === 'bot-groups')
  const providers = settingsRows.find((row) => row.id === 'bot-providers')
  const sidebar = registrations.find((r) => r.options && r.options.name === 'sidebar.panellist').options
  if (dock.id !== 'bot-groups' || dock.order !== 21) throw new Error(JSON.stringify(dock))
  if (!settings || settings.order !== 610 || settings.label() !== 'Bot 群') throw new Error(JSON.stringify(settings))
  if (!providers || providers.order !== 611 || providers.label() !== '模型服务商') throw new Error(JSON.stringify(providers))
  if (sidebar.id !== 'bot-groups' || sidebar.order !== 41 || sidebar.label() !== 'Bot 群') throw new Error(JSON.stringify(sidebar))
  return true
})
await check('注入了一份样式', () => styleNodes.length === 1 && String(styleNodes[0].textContent || '').includes('.bgx-root'))

const C = mod.__components

await check('Dock 渲染出「Bot 群」与「+ 拉群」', () => {
  const text = textOf(createElement(C.Dock, { ctx: fakeCtx }))
  if (!text.includes('Bot 群')) throw new Error(text)
  if (!text.includes('+ 拉群')) throw new Error(text)
  return true
})
await check('SettingsCard 渲染出运行时说明', () => {
  const text = textOf(createElement(C.SettingsCard, { ctx: fakeCtx }))
  if (!text.includes('Bot 群')) throw new Error(text)
  if (!text.includes('打开 Bot 群面板')) throw new Error(text)
  return true
})
await check('ProvidersCard 渲染出服务商标题与自定义入口', () => {
  const text = textOf(createElement(C.ProvidersCard, { ctx: fakeCtx }))
  if (!text.includes('模型服务商')) throw new Error(text)
  if (!text.includes('自定义服务商')) throw new Error(text)
  return true
})
await check('Shell 在无数据时渲染空状态', () => {
  const text = textOf(createElement(C.Shell, { ctx: fakeCtx }))
  if (!text.includes('还没有会话')) throw new Error(text)
  if (!text.includes('选一个群')) throw new Error(text)
  if (!text.includes('+ 私聊')) throw new Error(text)
  return true
})
await check('CreateGroupDialog 私聊模式不与群模板混用', () => {
  const bots = [{ id: 'bot_a', name: '阿尔法', role: '研究员' }]
  const dmText = textOf(createElement(C.CreateGroupDialog, { bots, initialKind: 'dm', onClose() {}, onCreated() {} }))
  if (!dmText.includes('和 Bot 私聊')) throw new Error(dmText)
  if (!dmText.includes('私聊名')) throw new Error(dmText)
  const groupText = textOf(createElement(C.CreateGroupDialog, { bots, onClose() {}, onCreated() {} }))
  if (!groupText.includes('发布评审') || !groupText.includes('功能开发')) throw new Error(groupText)
  return true
})
await check('MessageRow 渲染系统消息', () => {
  const text = textOf(
    createElement(C.MessageRow, { message: { id: 'm1', kind: 'system', role: 'lead', text: '群已创建' }, group: { members: [] } }),
  )
  if (!text.includes('群已创建')) throw new Error(text)
  return true
})
await check('MessageRow 渲染 Bot 发言（含状态与花费）', () => {
  const group = { members: [{ botId: 'bot_a', name: '阿尔法', role: '研究员' }] }
  const message = { id: 'm2', role: 'bot', botId: 'bot_a', name: '阿尔法', text: '我来接手', status: 'done', costCny: 0.012, at: new Date().toISOString() }
  const text = textOf(createElement(C.MessageRow, { message, group }))
  if (!text.includes('阿尔法')) throw new Error(text)
  if (!text.includes('我来接手')) throw new Error(text)
  if (!text.includes('已回复')) throw new Error(text)
  return true
})
await check('CreateGroupDialog 渲染成员与「拉群」按钮', () => {
  const bots = [
    { id: 'bot_a', name: '阿尔法', role: '研究员' },
    { id: 'bot_b', name: '贝塔', role: '工程师' },
  ]
  const text = textOf(createElement(C.CreateGroupDialog, { bots, onClose() {}, onCreated() {} }))
  if (!text.includes('拉个群')) throw new Error(text)
  if (!text.includes('阿尔法') || !text.includes('贝塔')) throw new Error(text)
  if (!text.includes('智能 @ 路由')) throw new Error(text)
  return true
})
await check('InviteDialog 过滤已在群里的成员', () => {
  const bots = [
    { id: 'bot_a', name: '阿尔法' },
    { id: 'bot_b', name: '贝塔' },
  ]
  const text = textOf(createElement(C.InviteDialog, { bots, existing: ['bot_a'], onClose() {}, onInvite() {} }))
  if (text.includes('阿尔法')) throw new Error(`不应包含已有成员：${text}`)
  if (!text.includes('贝塔')) throw new Error(text)
  return true
})

/* -------------------------------- api() -------------------------------- */
const fetchCalls = []
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url, init })
  if (url.endsWith('/boom')) {
    return Promise.resolve({ json: () => Promise.resolve({ ok: false, code: 'GROUP_NOT_FOUND', message: '群不存在' }) })
  }
  return Promise.resolve({ json: () => Promise.resolve({ ok: true, value: { groups: [] } }) })
}

await check('api() 解包 { ok, value }', async () => {
  const value = await C.api('/overview')
  if (!value || !Array.isArray(value.groups)) throw new Error(JSON.stringify(value))
  if (fetchCalls[0].url !== '/_dsh-bot-groups/overview') throw new Error(fetchCalls[0].url)
  return true
})
await check('api() 把 ok:false 变成带 code 的异常', async () => {
  let caught = null
  try {
    await C.api('/boom')
  } catch (error) {
    caught = error
  }
  if (!caught || caught.code !== 'GROUP_NOT_FOUND') throw new Error(String(caught))
  return true
})

/* ------------------------------ 收尾检查 -------------------------------- */
await check('渲染期间没有 console.error', () => {
  if (consoleErrors.length > 0) throw new Error(consoleErrors.join(' | '))
  return true
})

console.error = originError
console.log(failures === 0 ? '\n客户端自测全部通过' : `\n客户端自测失败 ${failures} 项`)
process.exitCode = failures === 0 ? 0 : 1
