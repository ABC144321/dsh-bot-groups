/**
 * dsh-grok-bot · 宿主端插件入口
 *
 * 结构：
 * - config.js   常量与默认配置
 * - errors.js   错误类型 / HTTP 状态映射
 * - http.js     JSON 响应、请求体、同源与 CSRF 校验
 * - store.js    群数据层（纯 Node，可独立测试）
 * - runtime.js  Bot 运行时适配（ctx.get('bot') + 动态模块加载）
 * - service.js  群业务逻辑
 * - routes.js   同源 HTTP API
 * - tools.js    bot_group_* 工具
 */

import { API_PREFIX, PLUGIN_NAME, inject } from './config.js'
import { GroupService } from './service.js'
import { makeRoutes } from './routes.js'
import { registerBotGroupTools } from './tools.js'

export { API_PREFIX, inject }
export { GroupError } from './errors.js'

export const name = PLUGIN_NAME

export async function apply(ctx, config = {}) {
  const logger = ctx.logger || {}
  const service = new GroupService(ctx, config || {}, logger)
  try {
    if (typeof ctx.set === 'function') ctx.set('botGroups', service)
  } catch (error) {
    logger?.warn?.(`${PLUGIN_NAME}: ctx.set('botGroups') 失败：${String(error?.message || error)}`)
  }

  const routes = makeRoutes(service, service.config)
  for (const route of routes) {
    const dispose = ctx.webServer.register(route)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => dispose, `${PLUGIN_NAME}: route ${route.path}`)
    }
  }

  // 预热运行时（不阻塞插件加载）
  service.bots.runtime().catch((error) => {
    logger?.warn?.(`${PLUGIN_NAME}: 运行时预热失败：${String(error?.message || error)}`)
  })

  try {
    const count = registerBotGroupTools(ctx, service, logger)
    logger?.info?.(`${PLUGIN_NAME}: 已注册 ${count} 个群聊工具`)
  } catch (error) {
    logger?.warn?.(`${PLUGIN_NAME}: 注册群聊工具失败：${String(error?.message || error)}`)
  }

  logger?.info?.(`${PLUGIN_NAME}: Bot 群已就绪`)
}

export default { name, inject, apply }
