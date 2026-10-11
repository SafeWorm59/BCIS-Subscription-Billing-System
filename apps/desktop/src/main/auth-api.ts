import {
  authenticationErrorResponseSchema,
  currentUserResponseSchema,
  loginRequestSchema,
  type LoginRequest,
  type SafeAuthenticatedUser
} from '@bcis/shared'

type AuthFetch = (input: string, init: RequestInit) => Promise<Response>

export interface AuthenticationApi {
  login(request: LoginRequest): Promise<SafeAuthenticatedUser>
  getCurrentUser(): Promise<SafeAuthenticatedUser | null>
  logout(): Promise<void>
}

export class AuthenticationApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'AuthenticationApiError'
  }
}

async function responseError(response: Response): Promise<AuthenticationApiError> {
  let message = `Authentication request failed (HTTP ${response.status}).`
  try {
    const body: unknown = await response.json()
    const parsed = authenticationErrorResponseSchema.safeParse(body)
    if (parsed.success) {
      message = parsed.data.error
    }
  } catch {
    // Keep the HTTP status message when the server does not return JSON.
  }
  return new AuthenticationApiError(message, response.status)
}

async function readCurrentUser(response: Response): Promise<SafeAuthenticatedUser> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('BCIS API returned an unreadable authentication response.')
  }

  const parsed = currentUserResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('BCIS API returned an invalid authentication response.')
  }
  return parsed.data.user
}

export function createAuthenticationApi(
  fetcher: AuthFetch,
  endpoint: () => string = () => 'http://127.0.0.1:3000',
  onSessionExpired?: () => void
): AuthenticationApi {
  const requestOptions = {
    credentials: 'include',
    cache: 'no-store'
  } satisfies RequestInit

  return {
    async login(request: LoginRequest): Promise<SafeAuthenticatedUser> {
      const parsedRequest = loginRequestSchema.safeParse(request)
      if (!parsedRequest.success) {
        throw new Error('Enter a valid login identifier and password.')
      }

      const response = await fetcher(`${endpoint()}/api/v1/auth/login`, {
        ...requestOptions,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedRequest.data)
      })
      if (!response.ok) {
        throw await responseError(response)
      }
      return readCurrentUser(response)
    },

    async getCurrentUser(): Promise<SafeAuthenticatedUser | null> {
      const response = await fetcher(`${endpoint()}/api/v1/auth/me`, {
        ...requestOptions,
        method: 'GET'
      })
      if (response.status === 401) {
        onSessionExpired?.()
        return null
      }
      if (!response.ok) {
        throw await responseError(response)
      }
      return readCurrentUser(response)
    },

    async logout(): Promise<void> {
      const response = await fetcher(`${endpoint()}/api/v1/auth/logout`, {
        ...requestOptions,
        method: 'POST'
      })
      if (!response.ok) {
        throw await responseError(response)
      }
      if (response.status !== 204) {
        throw new Error('BCIS API returned an unexpected logout response.')
      }
    }
  }
}
