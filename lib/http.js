/** HTTP 小工具：JSON 响应、请求体读取、同源校验。 */

import { statusFor } from './errors.js'

/** 写操作必须带这个头：跨站表单无法伪造自定义头，可挡住 CSRF。 */
export const WRITE_HEADER = 'x-dsh-grok-bot'

export function writeJson(res, status, value) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

export function writeError(res, error) {
  const code = (error && error.code) || 'INTERNAL'
  const message = (error && error.message) || String(error)
  writeJson(res, statusFor(error), { ok: false, code, message })
}

export function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
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

/**
 * 同源校验：Host 必须是本机；带了 Origin 时 Origin 也必须是本机。
 * 没有 Origin 的请求（原生客户端、curl）允许，但写操作还会额外校验 WRITE_HEADER。
 */
export function isLocalRequest(req) {
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

export function hasWriteHeader(req) {
  return String(req.headers[WRITE_HEADER] || '') === '1'
}

export function jsonValue(value) {
  return { ok: true, value }
}
