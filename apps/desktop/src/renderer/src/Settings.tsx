import { useEffect, useState } from 'react'
import type { SafeAuthenticatedUser } from '@bcis/shared'
import { roleNames, permissionKeys, type RoleName } from '@bcis/shared'

const confirmationKey = 'bcis.confirm-payments.v1'

export default function Settings({ user }: { user: SafeAuthenticatedUser }): React.JSX.Element {
  const [confirmPayments, setConfirmPayments] = useState(
    () => window.localStorage.getItem(confirmationKey) === 'true'
  )
  const [versions] = useState(() => window.api.getRuntimeVersions())
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking')
  const [endpoint, setEndpoint] = useState('')
  const [endpointMessage, setEndpointMessage] = useState('')
  const [endpointBusy, setEndpointBusy] = useState(false)

  useEffect(() => {
    let active = true
    window.api
      .getCurrentUser()
      .then((currentUser) => {
        if (active) setApiStatus(currentUser ? 'connected' : 'unavailable')
      })
      .catch(() => {
        if (active) setApiStatus('unavailable')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void window.api
      .getApiEndpoint()
      .then(setEndpoint)
      .catch(() => setEndpointMessage('Could not read API settings.'))
  }, [])

  async function saveEndpoint(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setEndpointBusy(true)
    setEndpointMessage('Testing endpoint…')
    try {
      const result = await window.api.updateApiEndpoint(endpoint)
      setEndpoint(result.endpoint)
      setEndpointMessage(
        result.changed
          ? 'Endpoint verified and saved. Sign in again at the new API.'
          : 'Endpoint verified; no change was needed.'
      )
    } catch (error) {
      setEndpointMessage(error instanceof Error ? error.message : 'Endpoint check failed.')
    } finally {
      setEndpointBusy(false)
    }
  }

  function updateConfirmation(enabled: boolean): void {
    setConfirmPayments(enabled)
    window.localStorage.setItem(confirmationKey, String(enabled))
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Workspace</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Local desktop preferences and connection diagnostics.
        </p>
      </div>
      <article className="max-w-3xl rounded-xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-semibold">API endpoint</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Set a verified HTTPS API endpoint. HTTP is allowed only for loopback development servers.
        </p>
        <form className="mt-4 flex flex-wrap gap-3" onSubmit={(event) => void saveEndpoint(event)}>
          <input
            aria-label="API endpoint"
            className="h-10 min-w-64 flex-1 rounded-lg border border-border bg-card px-3 text-sm"
            onChange={(event) => setEndpoint(event.target.value)}
            value={endpoint}
          />
          <button
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={endpointBusy || !user.permissions.includes('permissions.manage')}
            type="submit"
          >
            {endpointBusy ? 'Checking…' : 'Test and save'}
          </button>
        </form>
        {endpointMessage && (
          <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
            {endpointMessage}
          </p>
        )}
        {!user.permissions.includes('permissions.manage') && (
          <p className="mt-2 text-xs text-muted-foreground">
            Administrator permission is required to change the endpoint.
          </p>
        )}
      </article>
      {(user.permissions.includes('users.read') ||
        user.permissions.includes('users.manage') ||
        user.permissions.includes('roles.manage')) && <AdminSettings user={user} />}
      <article className="max-w-3xl rounded-xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-semibold">Payment confirmation</h2>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            checked={confirmPayments}
            className="mt-1"
            onChange={(event) => updateConfirmation(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="font-medium">Confirm before recording a payment</span>
            <span className="mt-1 block text-muted-foreground">
              Ask for confirmation before submitting a payment from invoice details. This preference
              is stored on this desktop only.
            </span>
          </span>
        </label>
      </article>
      <article className="max-w-3xl rounded-xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-semibold">Application and connection</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Signed in as</dt>
            <dd className="mt-1 text-sm">{user.loginIdentifier}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">API connection</dt>
            <dd className="mt-1 text-sm">{apiStatus === 'checking' ? 'Checking…' : apiStatus}</dd>
          </div>
          {versions &&
            Object.entries(versions).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs capitalize text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm">{value}</dd>
              </div>
            ))}
        </dl>
      </article>
    </section>
  )
}

function AdminSettings({ user }: { user: SafeAuthenticatedUser }): React.JSX.Element {
  const [users, setUsers] = useState<
    Awaited<ReturnType<typeof window.api.listAdminUsers>>['users']
  >([])
  const [roles, setRoles] = useState<
    Awaited<ReturnType<typeof window.api.listAdminRoles>>['roles']
  >([])
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [userStatus, setUserStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [newRole, setNewRole] = useState<RoleName>('Registrar / Staff')
  const [roleEdit, setRoleEdit] = useState<RoleName>('Registrar / Staff')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function refresh(): Promise<void> {
    if (user.permissions.includes('users.read')) setUsers((await window.api.listAdminUsers()).users)
    if (user.permissions.includes('roles.manage'))
      setRoles((await window.api.listAdminRoles()).roles)
  }
  useEffect(() => {
    let active = true
    const usersRequest = user.permissions.includes('users.read')
      ? window.api.listAdminUsers()
      : Promise.resolve({ users: [] })
    const rolesRequest = user.permissions.includes('roles.manage')
      ? window.api.listAdminRoles()
      : Promise.resolve({ roles: [] })
    void Promise.all([usersRequest, rolesRequest])
      .then(([userResult, roleResult]) => {
        if (active) {
          setUsers(userResult.users)
          setRoles(roleResult.roles)
        }
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(error instanceof Error ? error.message : 'Could not load administration data.')
      })
    return () => {
      active = false
    }
  }, [user.permissions])
  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await window.api.createAdminUser({ loginIdentifier: login, password, roles: [newRole] })
      setLogin('')
      setPassword('')
      await refresh()
      setMessage('User created.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create user.')
    } finally {
      setBusy(false)
    }
  }
  async function changeUser(id: string, status: 'active' | 'disabled'): Promise<void> {
    setBusy(true)
    setMessage('')
    try {
      await window.api.updateAdminUser(id, { status })
      await refresh()
      setMessage('User status updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update user.')
    } finally {
      setBusy(false)
    }
  }
  async function saveUserRoles(id: string, event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const selectedRoles = new FormData(event.currentTarget)
      .getAll('user-role')
      .map(String) as RoleName[]
    try {
      await window.api.updateAdminUser(id, { roles: selectedRoles })
      await refresh()
      setMessage('User roles updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update roles.')
    } finally {
      setBusy(false)
    }
  }
  async function savePermissions(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const permissions = new FormData(event.currentTarget).getAll('permission').map(String)
    try {
      await window.api.updateAdminRole(roleEdit, permissions)
      await refresh()
      setMessage('Role permissions updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update role.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="max-w-3xl rounded-xl border border-border bg-card p-6 shadow-card">
      <h2 className="font-semibold">Users and roles</h2>
      {user.permissions.includes('users.manage') && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
          <input
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            aria-label="New login identifier"
            placeholder="Login identifier"
            onChange={(event) => setLogin(event.target.value)}
            value={login}
            required
          />
          <input
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            aria-label="Temporary password"
            placeholder="Temporary password"
            type="password"
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            value={password}
            required
          />
          <select
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            aria-label="New user role"
            onChange={(event) => setNewRole(event.target.value as RoleName)}
            value={newRole}
          >
            {roleNames.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
          <button
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            disabled={busy}
            type="submit"
          >
            Create user
          </button>
        </form>
      )}
      {user.permissions.includes('users.read') && (
        <div className="mt-5 flex gap-3">
          <input
            aria-label="Search users"
            className="mt-5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search login identifier"
            value={userSearch}
          />
          <select
            aria-label="Filter users by status"
            className="rounded-lg border border-border bg-card px-3 text-sm"
            onChange={(event) => setUserStatus(event.target.value as typeof userStatus)}
            value={userStatus}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      )}
      {users
        .filter((item) =>
          item.loginIdentifier.toLowerCase().includes(userSearch.trim().toLowerCase())
        )
        .filter((item) => userStatus === 'all' || item.status === userStatus)
        .map((item) => (
          <div className="mt-3 border-t border-border pt-3 text-sm" key={item.id}>
            <div className="flex items-center justify-between">
              <span>
                {item.loginIdentifier} · {item.roles.join(', ') || 'No role'} · {item.status}
              </span>
              {user.permissions.includes('users.manage') && item.id !== user.id && (
                <button
                  className="text-primary"
                  disabled={busy}
                  onClick={() =>
                    void changeUser(item.id, item.status === 'active' ? 'disabled' : 'active')
                  }
                  type="button"
                >
                  {item.status === 'active' ? 'Disable' : 'Enable'}
                </button>
              )}
            </div>
            {user.permissions.includes('users.manage') && item.id !== user.id && (
              <form
                className="mt-2 flex flex-wrap items-center gap-3"
                key={`${item.id}-${item.roles.join('|')}`}
                onSubmit={(event) => void saveUserRoles(item.id, event)}
              >
                {roleNames.map((role) => (
                  <label className="flex items-center gap-1.5 text-xs" key={role}>
                    <input
                      defaultChecked={item.roles.includes(role)}
                      name="user-role"
                      type="checkbox"
                      value={role}
                    />
                    {role}
                  </label>
                ))}
                <button className="text-xs font-medium text-primary" disabled={busy} type="submit">
                  Save roles
                </button>
              </form>
            )}
          </div>
        ))}
      {user.permissions.includes('roles.manage') && roles.length > 0 && (
        <form
          className="mt-6 border-t border-border pt-4"
          key={roleEdit}
          onSubmit={(event) => void savePermissions(event)}
        >
          <label className="text-sm font-medium">
            Role permissions{' '}
            <select
              className="ml-3 rounded border border-border bg-card p-2"
              onChange={(event) => setRoleEdit(event.target.value as RoleName)}
              value={roleEdit}
            >
              {roles.map((role) => (
                <option key={role.name}>{role.name}</option>
              ))}
            </select>
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {permissionKeys.map((permission) => (
              <label className="flex gap-2 text-sm" key={permission}>
                <input
                  defaultChecked={roles
                    .find((role) => role.name === roleEdit)
                    ?.permissions.includes(permission)}
                  name="permission"
                  type="checkbox"
                  value={permission}
                />
                {permission}
              </label>
            ))}
          </div>
          <button
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            disabled={busy || !user.permissions.includes('permissions.manage')}
            type="submit"
          >
            Save role permissions
          </button>
        </form>
      )}
      {message && (
        <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </article>
  )
}
