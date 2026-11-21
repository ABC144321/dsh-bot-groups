/**
 * dsh-grok-bot · 常量与默认配置
 *
 * 注意：API 前缀与数据目录是兼容性契约，改名时保持不变，
 * 这样老版本的客户端面板和 ~/.dsh/bot 里的数据都能继续用。
 */

export const API_PREFIX = '/_dsh-bot-groups'

export const PLUGIN_NAME = 'dsh-grok-bot'

export const inject = ['tools', 'webServer', 'llm']

export const DEFAULT_CONFIG = {
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

export const MAX_TEXT = 40000
