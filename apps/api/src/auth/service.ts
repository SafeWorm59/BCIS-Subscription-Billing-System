import { createHash, randomBytes } from 'node:crypto'
import type {
  LoginRequest,
  PermissionKey,
  RoleName,
  SafeAuthenticatedUser,
  UserStatus
} from '@bcis/shared'
import { hashPassword, verifyPassword } from './password.js'

const sessionLifetimeMs = 12 * 60 * 60 * 1000
const tokenPattern = /^[A-Za-z0-9_-]{43}$/

export interface AuthUserRecord {
  id: string
  loginIdentifier: string
  passwordHash: string
  status: UserStatus
}

export interface AuthSessionRecord {
  userId: string
  loginIdentifier: string
  status: UserStatus
  expiresAt: Date
  revokedAt: Date | null
}

export interface AuthenticatedPrincipal {
  user: SafeAuthenticatedUser
  permissions: PermissionKey[]
}

export interface AuthRepository {
  findUserByLoginIdentifier(
    loginIdentifier: string
  ): Promise<AuthUserRecord | null>
  createSession(input: {
    userId: string
    tokenHash: string
    expiresAt: Date
  }): Promise<void>
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>
  listRoleNames(userId: string): Promise<RoleName[]>
  listPermissionKeys(userId: string): Promise<PermissionKey[]>
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>
}

export interface AuthService {
  initialize(): Promise<void>
  login(
    request: LoginRequest
  ): Promise<{ token: string; user: SafeAuthenticatedUser } | null>
  getSession(token: string): Promise<AuthenticatedPrincipal | null>
  revokeSession(token: string): Promise<void>
}

interface AuthServiceOptions {
  now?: () => Date
  verify?: typeof verifyPassword
  hashDummyPassword?: typeof hashPassword
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createAuthService(
  repository: AuthRepository,
  {
    now = () => new Date(),
    verify = verifyPassword,
    hashDummyPassword = hashPassword
  }: AuthServiceOptions = {}
): AuthService {
  let dummyPasswordHash: string | undefined
  let initialization: Promise<void> | undefined

  async function initialize(): Promise<void> {
    initialization ??= hashDummyPassword(
      randomBytes(32).toString('base64url')
    ).then((hash) => {
      dummyPasswordHash = hash
    })
    await initialization
  }

  return {
    initialize,

    async login(request) {
      const user = await repository.findUserByLoginIdentifier(
        request.loginIdentifier
      )

      if (!user) {
        if (dummyPasswordHash === undefined) {
          throw new Error('Authentication service is not initialized')
        }
        await verify(dummyPasswordHash, request.password)
        return null
      }

      const passwordIsValid = await verify(user.passwordHash, request.password)
      if (user.status !== 'active' || !passwordIsValid) {
        return null
      }

      const roles = await repository.listRoleNames(user.id)
      const permissions = await repository.listPermissionKeys(user.id)
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(now().getTime() + sessionLifetimeMs)
      await repository.createSession({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt
      })

      return {
        token,
        user: {
          id: user.id,
          loginIdentifier: user.loginIdentifier,
          status: user.status,
          roles,
          permissions
        }
      }
    },

    async getSession(token) {
      if (!tokenPattern.test(token)) {
        return null
      }

      const session = await repository.findSessionByTokenHash(
        hashSessionToken(token)
      )
      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= now().getTime() ||
        session.status !== 'active'
      ) {
        return null
      }

      const [roles, permissions] = await Promise.all([
        repository.listRoleNames(session.userId),
        repository.listPermissionKeys(session.userId)
      ])

      return {
        user: {
          id: session.userId,
          loginIdentifier: session.loginIdentifier,
          status: session.status,
          roles,
          permissions
        },
        permissions
      }
    },

    async revokeSession(token) {
      if (!tokenPattern.test(token)) {
        return
      }

      await repository.revokeSession(hashSessionToken(token), now())
    }
  }
}

export { hashSessionToken }
