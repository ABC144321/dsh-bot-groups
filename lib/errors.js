/** 统一错误类型与 HTTP 状态码映射。 */

export class GroupError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GroupError'
    this.code = code
  }
}

export function statusFor(error) {
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
