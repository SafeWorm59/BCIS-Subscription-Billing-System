import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  permissionKeySchema,
  roleNameSchema,
  userStatusSchema
} from '@bcis/shared'
import type {
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord
} from './service.js'
import {
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users
} from '../db/schema.js'
import type * as schema from '../db/schema.js'

type Database = NodePgDatabase<typeof schema>

export function createDatabaseAuthRepository(
  database: Database
): AuthRepository {
  return {
    async findUserByLoginIdentifier(
      loginIdentifier
    ): Promise<AuthUserRecord | null> {
      const [user] = await database
        .select({
          id: users.id,
          loginIdentifier: users.loginIdentifier,
          passwordHash: users.passwordHash,
          status: users.status
        })
        .from(users)
        .where(eq(users.loginIdentifier, loginIdentifier))
        .limit(1)

      return user
        ? {
            ...user,
            status: userStatusSchema.parse(user.status)
          }
        : null
    },

    async createSession(input) {
      await database.insert(sessions).values(input)
    },

    async findSessionByTokenHash(tokenHash): Promise<AuthSessionRecord | null> {
      const [result] = await database
        .select({
          userId: sessions.userId,
          loginIdentifier: users.loginIdentifier,
          status: users.status,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1)

      return result
        ? {
            ...result,
            status: userStatusSchema.parse(result.status)
          }
        : null
    },

    async listRoleNames(userId) {
      const rows = await database
        .select({ name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId))

      return rows.map(({ name }) => roleNameSchema.parse(name))
    },

    async listPermissionKeys(userId) {
      const rows = await database
        .select({ key: permissions.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(
          permissions,
          eq(rolePermissions.permissionId, permissions.id)
        )
        .where(eq(userRoles.userId, userId))

      return [...new Set(rows.map(({ key }) => permissionKeySchema.parse(key)))]
    },

    async revokeSession(tokenHash, revokedAt) {
      await database
        .update(sessions)
        .set({ revokedAt })
        .where(
          and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt))
        )
    }
  }
}
