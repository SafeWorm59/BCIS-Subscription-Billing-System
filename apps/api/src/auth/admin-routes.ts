import {
  and,
  eq,
  inArray,
  isNull,
  sql,
  type ExtractTablesWithRelations
} from 'drizzle-orm'
import type { NodePgTransaction } from 'drizzle-orm/node-postgres'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  permissionKeys,
  roleNames,
  type PermissionKey,
  type RoleName
} from '@bcis/shared'
import { database } from '../db/client.js'
import {
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users
} from '../db/schema.js'
import type * as schema from '../db/schema.js'
import { hashPassword } from './password.js'
import { createAuthenticationHook, requirePermission } from './routes.js'
import type { AuthService } from './service.js'

const idSchema = z.uuid()
const requiredAdministratorPermissions = [
  'users.read',
  'users.manage',
  'roles.manage',
  'permissions.manage'
] as const
type Transaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

async function assignRoles(
  tx: Transaction,
  userId: string,
  names: readonly RoleName[]
): Promise<void> {
  const rows = await tx
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.name, [...names]))
  if (rows.length !== new Set(names).size)
    throw new Error('One or more configured roles are unavailable.')
  await tx.delete(userRoles).where(eq(userRoles.userId, userId))
  if (rows.length)
    await tx
      .insert(userRoles)
      .values(rows.map(({ id }) => ({ userId, roleId: id })))
}

async function ensurePrivilegedUserRemains(tx: Transaction): Promise<void> {
  const result = await tx
    .select({ id: users.id, permission: permissions.key })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(users.status, 'active'),
        inArray(permissions.key, [...requiredAdministratorPermissions])
      )
    )
  const grantsByUser = new Map<string, Set<PermissionKey>>()
  for (const row of result) {
    const grants = grantsByUser.get(row.id) ?? new Set<PermissionKey>()
    grants.add(row.permission as PermissionKey)
    grantsByUser.set(row.id, grants)
  }
  if (!hasCompleteAdministratorPermissions([...grantsByUser.values()]))
    throw Object.assign(
      new Error(
        'At least one active user with complete administrative access must remain.'
      ),
      { statusCode: 409 }
    )
}

export function hasCompleteAdministratorPermissions(
  permissionSets: Iterable<ReadonlySet<PermissionKey>>
): boolean {
  return [...permissionSets].some((permissionsForUser) =>
    requiredAdministratorPermissions.every((permission) =>
      permissionsForUser.has(permission)
    )
  )
}

async function assertRolePermissionsGrantable(
  tx: Transaction,
  names: readonly RoleName[],
  grantable: ReadonlySet<PermissionKey>
): Promise<void> {
  const requestedPermissions = await tx
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .where(inArray(roles.name, [...names]))
  if (
    requestedPermissions.some(({ key }) => !grantable.has(key as PermissionKey))
  )
    throw Object.assign(new Error('Cannot grant permissions you do not hold'), {
      statusCode: 403
    })
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  authService: AuthService,
  secureCookies: boolean
): Promise<void> {
  const authenticate = createAuthenticationHook(authService, secureCookies)
  app.get(
    '/admin/users',
    { preHandler: [authenticate, requirePermission('users.read')] },
    async () => {
      const rows = await database
        .select({
          id: users.id,
          loginIdentifier: users.loginIdentifier,
          status: users.status,
          createdAt: users.createdAt,
          role: roles.name,
          permission: permissions.key
        })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, eq(roles.id, userRoles.roleId))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      const result = new Map<
        string,
        {
          id: string
          loginIdentifier: string
          status: 'active' | 'disabled'
          createdAt: string
          roles: Set<RoleName>
          permissions: Set<PermissionKey>
        }
      >()
      for (const row of rows) {
        let user = result.get(row.id)
        if (!user) {
          user = {
            id: row.id,
            loginIdentifier: row.loginIdentifier,
            status: row.status as 'active' | 'disabled',
            createdAt: row.createdAt.toISOString(),
            roles: new Set(),
            permissions: new Set()
          }
          result.set(row.id, user)
        }
        if (row.role) user.roles.add(row.role as RoleName)
        if (row.permission)
          user.permissions.add(row.permission as PermissionKey)
      }
      return {
        users: [...result.values()].map((user) => ({
          ...user,
          roles: [...user.roles],
          permissions: [...user.permissions]
        }))
      }
    }
  )
  app.post(
    '/admin/users',
    { preHandler: [authenticate, requirePermission('users.manage')] },
    async (request, reply) => {
      if (!request.auth)
        return reply.code(401).send({ error: 'Authentication required' })
      const parsed = z
        .object({
          loginIdentifier: z
            .string()
            .trim()
            .min(1)
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z.string().min(1).max(1024),
          roles: z.array(z.enum(roleNames)).min(1)
        })
        .strict()
        .safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid request' })
      const grantable = new Set(request.auth.permissions)
      try {
        const passwordHash = await hashPassword(parsed.data.password)
        await database.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(8123371)`)
          await assertRolePermissionsGrantable(tx, parsed.data.roles, grantable)
          const [user] = await tx
            .insert(users)
            .values({
              loginIdentifier: parsed.data.loginIdentifier,
              passwordHash
            })
            .returning({ id: users.id })
          if (!user) throw new Error('User creation failed')
          await assignRoles(tx, user.id, parsed.data.roles)
        })
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23505'
        )
          return reply
            .code(409)
            .send({ error: 'A user with this login identifier already exists' })
        throw error
      }
      return reply.code(201).send({ success: true })
    }
  )
  app.patch(
    '/admin/users/:id',
    { preHandler: [authenticate, requirePermission('users.manage')] },
    async (request, reply) => {
      if (!request.auth)
        return reply.code(401).send({ error: 'Authentication required' })
      const params = z.object({ id: idSchema }).safeParse(request.params)
      const body = z
        .object({
          status: z.enum(['active', 'disabled']).optional(),
          roles: z.array(z.enum(roleNames)).min(1).optional()
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .safeParse(request.body)
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'Invalid request' })
      if (params.data.id === request.auth!.user.id)
        return reply
          .code(409)
          .send({ error: 'You cannot change your own access or status' })
      await database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(8123371)`)
        const [targetUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, params.data.id))
        if (!targetUser)
          throw Object.assign(new Error('User not found'), { statusCode: 404 })
        if (body.data.roles) {
          await assertRolePermissionsGrantable(
            tx,
            body.data.roles,
            new Set(request.auth!.permissions)
          )
          await assignRoles(tx, params.data.id, body.data.roles)
        }
        if (body.data.status) {
          await tx
            .update(users)
            .set({ status: body.data.status, updatedAt: new Date() })
            .where(eq(users.id, params.data.id))
          if (body.data.status === 'disabled')
            await tx
              .update(sessions)
              .set({ revokedAt: new Date() })
              .where(
                and(
                  eq(sessions.userId, params.data.id),
                  isNull(sessions.revokedAt)
                )
              )
        }
        await ensurePrivilegedUserRemains(tx)
      })
      return reply.send({ success: true })
    }
  )
  app.get(
    '/admin/roles',
    { preHandler: [authenticate, requirePermission('roles.manage')] },
    async () => {
      const rows = await database
        .select({ name: roles.name, permission: permissions.key })
        .from(roles)
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      return {
        roles: roleNames.map((name) => ({
          name,
          permissions: [
            ...new Set(
              rows
                .filter((row) => row.name === name && row.permission)
                .map((row) => row.permission as PermissionKey)
            )
          ]
        }))
      }
    }
  )
  app.put(
    '/admin/roles/:name/permissions',
    { preHandler: [authenticate, requirePermission('permissions.manage')] },
    async (request, reply) => {
      if (!request.auth)
        return reply.code(401).send({ error: 'Authentication required' })
      const params = z
        .object({ name: z.enum(roleNames) })
        .safeParse(request.params)
      const body = z
        .object({ permissions: z.array(z.enum(permissionKeys)) })
        .strict()
        .safeParse(request.body)
      if (!params.success || !body.success)
        return reply.code(400).send({ error: 'Invalid request' })
      if (
        body.data.permissions.some(
          (key) => !request.auth!.permissions.includes(key)
        )
      )
        return reply
          .code(403)
          .send({ error: 'Cannot grant permissions you do not hold' })
      await database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(8123371)`)
        const [role] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, params.data.name))
        if (!role)
          throw Object.assign(new Error('Role not found'), { statusCode: 404 })
        const permissionRows = body.data.permissions.length
          ? await tx
              .select({ id: permissions.id })
              .from(permissions)
              .where(inArray(permissions.key, body.data.permissions))
          : []
        if (permissionRows.length !== new Set(body.data.permissions).size)
          throw Object.assign(
            new Error('One or more permission records are unavailable.'),
            { statusCode: 409 }
          )
        await tx
          .delete(rolePermissions)
          .where(eq(rolePermissions.roleId, role.id))
        if (permissionRows.length)
          await tx.insert(rolePermissions).values(
            permissionRows.map(({ id }) => ({
              roleId: role.id,
              permissionId: id
            }))
          )
        await ensurePrivilegedUserRemains(tx)
      })
      return reply.send({ success: true })
    }
  )
}
