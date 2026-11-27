export class AntigravityError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'AntigravityError'
    this.code = code
  }
}

export function publicError(error) {
  if (error instanceof AntigravityError) {
    return { code: error.code, message: error.message }
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === -32000) {
    return {
      code: 'AUTH_REQUIRED',
      message: 'Antigravity CLI is not signed in. Sign in with the official agy outside DSH, then retry.',
    }
  }
  return {
    code: 'ACP_FAILURE',
    message: 'Antigravity could not complete the operation. Retry or open a new conversation.',
  }
}

export function isAuthRequired(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (('code' in error && error.code === -32000) ||
        ('errorMessage' in error && typeof error.errorMessage === 'string' && /authentication required/i.test(error.errorMessage)) ||
        ('message' in error && typeof error.message === 'string' && /authentication required/i.test(error.message))),
  )
}
