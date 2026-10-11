export class BusinessError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'BusinessError'
  }
}

export function translateDatabaseError(error: unknown): BusinessError | null {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    if (error.code === '23505') {
      return new BusinessError(
        'A record with this identifier already exists',
        409
      )
    }
    if (error.code === '23503') {
      return new BusinessError(
        'A referenced record does not exist or is in use',
        409
      )
    }
    if (error.code === '23514' || error.code === '22P02') {
      return new BusinessError('The supplied value is invalid', 400)
    }
  }
  return null
}
