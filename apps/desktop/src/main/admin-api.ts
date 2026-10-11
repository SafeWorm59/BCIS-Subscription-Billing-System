import {
  adminUserListResponseSchema,
  roleAdministrationListSchema,
  userCreateAdminSchema,
  userUpdateAdminSchema,
  type RoleName
} from '@bcis/shared'
import { z } from 'zod'

type Fetcher = (input: string, init: RequestInit) => Promise<Response>
const successSchema = z.object({ success: z.literal(true) }).strict()
type AdminApi = {
  listUsers(): Promise<z.infer<typeof adminUserListResponseSchema>>
  listRoles(): Promise<z.infer<typeof roleAdministrationListSchema>>
  createUser(input: unknown): Promise<void>
  updateUser(id: string, input: unknown): Promise<void>
  updateRole(name: RoleName, permissions: string[]): Promise<void>
}

export function createAdminApi(
  fetcher: Fetcher,
  endpoint: () => string,
  onSessionExpired?: () => void
): AdminApi {
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await fetcher(`${endpoint()}/api/v1${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    })
    if (response.status === 401) {
      onSessionExpired?.()
      throw new Error('Your session expired. Sign in again to continue.')
    }
    if (response.status === 403) throw new Error('Administrative access is required.')
    if (!response.ok && response.status !== 201) {
      const error = (await response.json().catch(() => null)) as { error?: unknown } | null
      throw new Error(
        typeof error?.error === 'string'
          ? error.error
          : `Administrative request failed (HTTP ${response.status}).`
      )
    }
    if (response.status === 204) return undefined
    return response.json()
  }
  return {
    async listUsers() {
      return adminUserListResponseSchema.parse(await request('/admin/users'))
    },
    async listRoles() {
      return roleAdministrationListSchema.parse(await request('/admin/roles'))
    },
    async createUser(input: unknown) {
      const value = userCreateAdminSchema.parse(input)
      successSchema.parse(await request('/admin/users', 'POST', value))
    },
    async updateUser(id: string, input: unknown) {
      const value = userUpdateAdminSchema.parse(input)
      successSchema.parse(await request(`/admin/users/${encodeURIComponent(id)}`, 'PATCH', value))
    },
    async updateRole(name: RoleName, permissions: string[]) {
      successSchema.parse(
        await request(`/admin/roles/${encodeURIComponent(name)}/permissions`, 'PUT', {
          permissions
        })
      )
    }
  }
}
