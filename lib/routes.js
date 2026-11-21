/** 同源 HTTP API：/_dsh-bot-groups/* */

import { API_PREFIX } from './config.js'
import { GROUP_MODES } from './store.js'
import { hasWriteHeader, isLocalRequest, jsonValue, readJsonBody, writeError, writeJson } from './http.js'

const METHOD_NOT_ALLOWED = { ok: false, code: 'METHOD_NOT_ALLOWED' }
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' }

export function makeRoutes(service, config) {
  const prefix = API_PREFIX

  const handle = async (req, res, segments) => {
    const method = req.method || 'GET'

    if (segments.length === 0 || segments[0] === 'overview') {
      if (method !== 'GET') return writeJson(res, 405, METHOD_NOT_ALLOWED)
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
      if (method !== 'GET') return writeJson(res, 405, METHOD_NOT_ALLOWED)
      return writeJson(res, 200, jsonValue(await service.diag()))
    }

    if (segments[0] === 'dm') {
      if (method !== 'POST') return writeJson(res, 405, METHOD_NOT_ALLOWED)
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
        if (method !== 'GET') return writeJson(res, 405, METHOD_NOT_ALLOWED)
        return writeJson(res, 200, jsonValue({ bots: await service.listBotsSafe() }))
      }
      if (segments.length === 3 && segments[2] === 'model' && method === 'POST') {
        const body = (await readJsonBody(req)) || {}
        const result = await service.setBotModel(segments[1], body)
        return writeJson(res, 200, jsonValue(result))
      }
      return writeJson(res, 404, NOT_FOUND)
    }

    if (segments[0] === 'providers') {
      if (segments.length === 1) {
        if (method === 'GET') return writeJson(res, 200, jsonValue(service.providerList()))
        if (method !== 'POST') return writeJson(res, 405, METHOD_NOT_ALLOWED)
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
      return writeJson(res, 404, NOT_FOUND)
    }

    if (segments[0] !== 'groups') {
      return writeJson(res, 404, NOT_FOUND)
    }

    // POST /groups
    if (segments.length === 1) {
      if (method !== 'POST') return writeJson(res, 405, METHOD_NOT_ALLOWED)
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
      return writeJson(res, 405, METHOD_NOT_ALLOWED)
    }

    if (segments.length === 3 && action === 'export' && method === 'GET') {
      return writeJson(res, 200, jsonValue(await service.exportMarkdown(id)))
    }

    if (method !== 'POST') return writeJson(res, 405, METHOD_NOT_ALLOWED)
    const body = (await readJsonBody(req)) || undefined
    if (body === undefined) return writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '请求体不是合法 JSON' })

    switch (action) {
      case 'messages': {
        const result = await service.postHuman(id, body.text, {
          reply: body.reply !== false,
          authorName: body.authorName,
          replyTo: body.replyTo,
          attachments: body.attachments,
          dryRun: body.dryRun === true,
        })
        return writeJson(res, 200, jsonValue(result))
      }
      case 'rounds': {
        const result = await service.startRound(id, { botIds: body.botIds, source: body.source || 'panel', dryRun: body.dryRun === true })
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
        return writeJson(res, 404, NOT_FOUND)
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
          // 写操作要求自定义头：跨站表单无法携带，挡掉 CSRF；同时也挡住无头的裸请求。
          const method = String(req.method || 'GET').toUpperCase()
          if (method !== 'GET' && method !== 'HEAD' && !hasWriteHeader(req)) {
            writeJson(res, 403, { ok: false, code: 'FORBIDDEN', message: '写操作缺少 x-dsh-grok-bot 请求头' })
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
