import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  BadgeCheck,
  Cable,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  FileText,
  LoaderCircle,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  Mail,
  Settings as SettingsIcon,
  UsersRound,
  WalletCards,
  Wifi,
  type LucideIcon
} from 'lucide-react'
import type {
  BillingSummary,
  LoginRequest,
  PermissionKey,
  SafeAuthenticatedUser
} from '@bcis/shared'
import Management from './Management'
import Billing from './Billing'
import Payments from './Payments'
import Reports from './Reports'
import Settings from './Settings'
import { calendarMonthRange, formatPhpMoney } from './lib/business-format'

const navigationItems: { label: string; icon: LucideIcon; permission?: PermissionKey }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Plans', icon: FileText, permission: 'plans.read' },
  { label: 'Subscribers', icon: UsersRound, permission: 'subscribers.read' },
  { label: 'Service Accounts', icon: Wifi, permission: 'service_accounts.read' },
  { label: 'Billing', icon: WalletCards, permission: 'invoices.read' },
  { label: 'Payments', icon: CreditCard, permission: 'invoices.read' },
  { label: 'Collections', icon: CircleDollarSign, permission: 'invoices.read' },
  { label: 'Reports', icon: BarChart3, permission: 'invoices.read' },
  { label: 'Settings', icon: SettingsIcon }
]

function getAuthenticationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/ERR_CONNECTION|failed to fetch|networkerror|fetch failed/i.test(error.message)) {
      return "Can't connect to the configured BCIS API endpoint. Check the endpoint in Settings and make sure the API service is running."
    }
    return error.message
  }
  return 'Authentication failed. Please try again.'
}

function App(): React.JSX.Element {
  const [authState, setAuthState] = useState<
    | { status: 'checking' }
    | { status: 'anonymous'; message: string | null }
    | { status: 'authenticated'; user: SafeAuthenticatedUser }
  >({ status: 'checking' })

  useEffect(() => {
    const unsubscribe = window.api.onSessionExpired?.(() => {
      setAuthState({
        status: 'anonymous',
        message: 'Your session expired. Sign in again to continue.'
      })
    })
    let active = true

    window.api
      .getCurrentUser()
      .then((user) => {
        if (active) {
          setAuthState(
            user ? { status: 'authenticated', user } : { status: 'anonymous', message: null }
          )
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthState({
            status: 'anonymous',
            message: getAuthenticationErrorMessage(error)
          })
        }
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  async function handleLogin(request: LoginRequest): Promise<void> {
    const user = await window.api.login(request)
    setAuthState({ status: 'authenticated', user })
  }

  async function handleLogout(): Promise<void> {
    await window.api.logout()
    setAuthState({ status: 'anonymous', message: null })
  }

  if (authState.status === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-primary" />
          Checking your session…
        </div>
      </main>
    )
  }

  if (authState.status === 'anonymous') {
    return <LoginScreen initialMessage={authState.message} onLogin={handleLogin} />
  }

  return <Dashboard user={authState.user} onLogout={handleLogout} />
}

function LoginScreen({
  initialMessage,
  onLogin
}: {
  initialMessage: string | null
  onLogin: (request: LoginRequest) => Promise<void>
}): React.JSX.Element {
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await onLogin({ loginIdentifier, password })
    } catch (loginError: unknown) {
      setError(getAuthenticationErrorMessage(loginError))
      setIsSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(320px,0.9fr)_1.1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        <div className="absolute -right-36 -top-40 size-[440px] rounded-full border border-white/5" />
        <div className="absolute -right-20 -top-24 size-[310px] rounded-full border border-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <Cable aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">BCIS</p>
            <p className="mt-0.5 text-[9px] tracking-[0.12em] text-slate-400">
              SUBSCRIPTION BILLING &amp; COLLECTION
            </p>
          </div>
        </div>

        <div className="relative max-w-md pb-8">
          <div className="mb-6 flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-blue-300">
            <BadgeCheck aria-hidden="true" className="size-6" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            Bukidnon Cable and Internet Services
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">
            Your operations,
            <br />
            all in one place.
          </h1>
          <p className="mt-5 text-sm leading-6 text-slate-400">
            Sign in to manage your subscription billing and collection workspace.
          </p>
        </div>

        <p className="relative text-xs text-slate-500">Secure access for authorized BCIS staff</p>
      </section>

      <section className="flex min-h-screen flex-col items-center justify-center px-6 py-10 sm:px-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Cable aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">BCIS</p>
            <p className="text-[10px] text-muted-foreground">
              Subscription Billing &amp; Collection
            </p>
          </div>
        </div>

        <div className="w-full max-w-[420px]">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
              Welcome back
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              Sign in to BCIS
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Enter your account credentials to continue to your workspace.
            </p>
          </div>

          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="loginIdentifier">
                Email or username
              </label>
              <div className="relative">
                <Mail
                  aria-hidden="true"
                  className="absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-slate-400"
                />
                <input
                  autoComplete="username"
                  className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring/20"
                  id="loginIdentifier"
                  onChange={(event) => setLoginIdentifier(event.target.value)}
                  placeholder="you@example.com"
                  required
                  value={loginIdentifier}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <LockKeyhole
                  aria-hidden="true"
                  className="absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-slate-400"
                />
                <input
                  autoComplete="current-password"
                  className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring/20"
                  id="password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  type="password"
                  value={password}
                />
              </div>
            </div>

            {(error ?? initialMessage) && (
              <p
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-800"
                role="alert"
              >
                {error ?? initialMessage}
              </p>
            )}

            <button
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || !loginIdentifier.trim() || !password}
              type="submit"
            >
              {isSubmitting && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-7 text-center text-xs text-muted-foreground">
            Access is limited to authorized BCIS accounts.
          </p>
        </div>
      </section>
    </main>
  )
}

function Dashboard({
  user,
  onLogout
}: {
  user: SafeAuthenticatedUser
  onLogout: () => Promise<void>
}): React.JSX.Element {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [section, setSection] = useState('Dashboard')

  async function logout(): Promise<void> {
    setIsLoggingOut(true)
    setLogoutError(null)
    try {
      await onLogout()
    } catch (error: unknown) {
      setLogoutError(getAuthenticationErrorMessage(error))
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-[248px] shrink-0 flex-col bg-sidebar text-sidebar-foreground max-[720px]:w-[76px]">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-5 max-[720px]:justify-center max-[720px]:px-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Cable aria-hidden="true" className="size-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 max-[720px]:hidden">
            <p className="truncate text-sm font-semibold tracking-tight text-white">BCIS</p>
            <p className="mt-0.5 text-[9px] leading-3.5 text-slate-400">
              SUBSCRIPTION BILLING
              <br />
              AND COLLECTION SYSTEM
            </p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 px-3 py-6 max-[720px]:px-2">
          <p className="mb-3 px-3 text-[10px] font-semibold tracking-[0.16em] text-slate-500 max-[720px]:hidden">
            WORKSPACE
          </p>
          <ul className="space-y-1">
            {navigationItems
              .filter(({ permission }) => !permission || user.permissions.includes(permission))
              .map(({ label, icon: Icon }) => (
                <li key={label}>
                  <button
                    aria-current={section === label ? 'page' : undefined}
                    className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring max-[720px]:justify-center max-[720px]:px-0 ${
                      section === label
                        ? 'bg-sidebar-accent text-white shadow-sm'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                    onClick={() => setSection(label)}
                    title={label}
                    type="button"
                  >
                    <Icon
                      aria-hidden="true"
                      className={`size-[18px] shrink-0 ${section === label ? 'text-blue-300' : 'text-slate-500'}`}
                    />
                    <span className="max-[720px]:hidden">{label}</span>
                  </button>
                </li>
              ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-5 py-4 max-[720px]:px-0">
          <div className="flex items-center gap-3 max-[720px]:justify-center">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-300">
              <UsersRound aria-hidden="true" className="size-4" />
            </div>
            <div className="min-w-0 max-[720px]:hidden">
              <p className="truncate text-xs font-medium text-slate-200">{user.loginIdentifier}</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-500">
                {user.roles[0] ?? 'BCIS user'}
              </p>
            </div>
            <button
              aria-label="Sign out"
              className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 max-[720px]:ml-0"
              disabled={isLoggingOut}
              onClick={() => void logout()}
              title="Sign out"
              type="button"
            >
              {isLoggingOut ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <LogOut aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1" id="dashboard">
        <header className="flex h-[76px] items-center justify-between border-b border-border bg-card px-8 max-[520px]:px-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="max-[520px]:hidden">Workspace</span>
            <ChevronRight aria-hidden="true" className="size-4 text-slate-300 max-[520px]:hidden" />
            <span className="font-medium text-foreground">{section}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground max-[520px]:hidden">
              {section === 'Dashboard' ? 'Overview' : 'Management'}
            </span>
            <button
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
              disabled={isLoggingOut}
              onClick={() => void logout()}
              type="button"
            >
              {isLoggingOut ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <LogOut aria-hidden="true" className="size-4 text-muted-foreground" />
              )}
              <span className="max-[520px]:hidden">
                {isLoggingOut ? 'Signing out…' : 'Sign out'}
              </span>
            </button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1180px] px-8 py-9 max-[520px]:px-5 max-[520px]:py-7">
          {logoutError && (
            <p
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              role="alert"
            >
              {logoutError}
            </p>
          )}
          {section === 'Dashboard' && <DashboardOverview user={user} navigate={setSection} />}
          {section === 'Billing' && <Billing permissions={user.permissions} />}
          {section === 'Payments' && <Payments />}
          {section === 'Collections' && (
            <Billing mode="collections" permissions={user.permissions} />
          )}
          {section === 'Reports' && <Reports />}
          {section === 'Settings' && <Settings user={user} />}
          {['Plans', 'Subscribers', 'Service Accounts'].includes(section) && (
            <Management
              key={section}
              section={section as 'Plans' | 'Subscribers' | 'Service Accounts'}
              permissions={user.permissions}
            />
          )}
        </div>
      </main>
    </div>
  )
}

export default App

function dashboardMonthRange(month: string): {
  billingPeriodStart: string
  billingPeriodEnd: string
} {
  const { start, end } = calendarMonthRange(month)
  return { billingPeriodStart: start, billingPeriodEnd: end }
}

const dashboardMoney = formatPhpMoney

function DashboardOverview({
  user,
  navigate
}: {
  user: SafeAuthenticatedUser
  navigate: (section: string) => void
}): React.JSX.Element {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [refreshKey, setRefreshKey] = useState(0)
  const [data, setData] = useState<{
    subscribers?: number
    serviceAccounts?: number
    activeAccounts?: number
    plans?: number
    payments?: number
    billing?: BillingSummary
  }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const range = useMemo(() => dashboardMonthRange(month), [month])

  useEffect(() => {
    let active = true
    const requests: Array<Promise<[keyof typeof data, unknown]>> = []
    if (user.permissions.includes('subscribers.read'))
      requests.push(
        window.api
          .listSubscribers({ page: 1, limit: 1 })
          .then((result) => ['subscribers', result.total])
      )
    if (user.permissions.includes('service_accounts.read')) {
      requests.push(
        window.api
          .listServiceAccounts({ page: 1, limit: 1 })
          .then((result) => ['serviceAccounts', result.total])
      )
      requests.push(
        window.api
          .listServiceAccounts({ page: 1, limit: 1, status: 'active' })
          .then((result) => ['activeAccounts', result.total])
      )
    }
    if (user.permissions.includes('plans.read'))
      requests.push(
        window.api.listPlans({ page: 1, limit: 1 }).then((result) => ['plans', result.total])
      )
    if (user.permissions.includes('invoices.read')) {
      requests.push(window.api.getBillingSummary(range).then((result) => ['billing', result]))
      requests.push(
        window.api
          .listPayments({
            page: 1,
            limit: 1,
            receivedAtStart: range.billingPeriodStart,
            receivedAtEnd: range.billingPeriodEnd
          })
          .then((result) => ['payments', result.total])
      )
    }
    Promise.all(requests)
      .then((entries) => {
        if (active) setData(Object.fromEntries(entries))
      })
      .catch((requestError: unknown) => {
        if (active) setError(getAuthenticationErrorMessage(requestError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [range, refreshKey, user.permissions])

  const cards = [
    data.subscribers !== undefined && {
      label: 'Subscribers',
      value: String(data.subscribers),
      detail: 'All subscriber records'
    },
    data.serviceAccounts !== undefined && {
      label: 'Service accounts',
      value: String(data.serviceAccounts),
      detail: `${data.activeAccounts ?? 0} active`
    },
    data.plans !== undefined && {
      label: 'Plans',
      value: String(data.plans),
      detail: 'Configured plans'
    },
    data.billing && {
      label: 'Billed this month',
      value: dashboardMoney(data.billing.totalBilled),
      detail: `${data.billing.unpaidInvoiceCount} open invoices`
    },
    data.billing && {
      label: 'Collected this month',
      value: dashboardMoney(data.billing.totalCollected),
      detail: `${data.payments ?? 0} payment records`
    },
    data.billing && {
      label: 'Outstanding',
      value: dashboardMoney(data.billing.totalOutstanding),
      detail: `${data.billing.overdueInvoiceCount} overdue invoices`
    }
  ].filter((card): card is { label: string; value: string; detail: string } => Boolean(card))

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            BCIS subscription billing
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Workspace overview</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Live totals from the records available to your account.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Billing month
            <input
              aria-label="Dashboard billing month"
              className="block h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
              onChange={(event) => {
                setLoading(true)
                setError(null)
                setMonth(event.target.value)
              }}
              type="month"
              value={month}
            />
          </label>
          <button
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setError(null)
              setRefreshKey((value) => value + 1)
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <div
          className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <span>{error}</span>
          <button
            onClick={() => {
              setLoading(true)
              setError(null)
              setRefreshKey((value) => value + 1)
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 inline size-4 animate-spin" />
          Loading workspace totals…
        </div>
      ) : cards.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <article
              className="rounded-xl border border-border bg-card p-5 shadow-card"
              key={card.label}
            >
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <p className="mt-4 text-2xl font-semibold tracking-tight">{card.value}</p>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                {card.detail}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
          No summary data is available for this account.
        </p>
      )}
      {data.billing && (
        <article className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent invoices</h2>
            <button
              className="text-sm font-medium text-primary"
              onClick={() => navigate('Billing')}
              type="button"
            >
              Open billing
            </button>
          </div>
          {data.billing.recentInvoices.length ? (
            <ul className="mt-3 divide-y divide-border">
              {data.billing.recentInvoices.map((invoice) => (
                <li className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={invoice.id}>
                  <span>
                    <span className="font-mono text-xs font-semibold">{invoice.invoiceNumber}</span>
                    <span className="ml-3 text-muted-foreground">{invoice.subscriberName}</span>
                  </span>
                  <span>
                    {dashboardMoney(invoice.total)} · {invoice.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No invoices have been generated yet.
            </p>
          )}
        </article>
      )}
    </section>
  )
}
