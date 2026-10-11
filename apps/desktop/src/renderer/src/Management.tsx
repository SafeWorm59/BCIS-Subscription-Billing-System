import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, Plus, Search } from 'lucide-react'
import {
  planCreateSchema,
  serviceAccountCreateSchema,
  serviceAccountStatuses,
  subscriberCreateSchema,
  type Plan,
  type PermissionKey,
  type ServiceAccount,
  type ServiceAccountStatus,
  type Subscriber
} from '@bcis/shared'

type Section = 'Plans' | 'Subscribers' | 'Service Accounts'
type RecordValue = Plan | Subscriber | ServiceAccount
type PageResult<T> = { items: T[]; page: number; limit: number; total: number }
type ViewState =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'detail'; record: RecordValue }
  | { mode: 'edit'; record: RecordValue }

const pageSize = 25

async function loadEveryPage<T>(
  load: (page: number) => Promise<{ items: T[]; total: number }>
): Promise<T[]> {
  const firstPage = await load(1)
  const items = [...firstPage.items]
  for (let page = 2; items.length < firstPage.total; page += 1) {
    const nextPage = await load(page)
    if (!nextPage.items.length) break
    items.push(...nextPage.items)
  }
  return items
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The request failed. Please try again.'
}

function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function optional(value: string): string | null {
  return value || null
}

function Field({
  label,
  name,
  defaultValue = '',
  required = false,
  type = 'text',
  maxLength
}: {
  label: string
  name: string
  defaultValue?: string
  required?: boolean
  type?: string
  maxLength?: number
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      {label}
      <input
        className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
        defaultValue={defaultValue}
        maxLength={maxLength}
        name={name}
        required={required}
        type={type}
      />
    </label>
  )
}

function SelectField({
  label,
  name,
  value,
  onChange,
  options
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      {label}
      <select
        className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
        onChange={(event) => onChange(event.target.value)}
        value={value}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function Management({
  section,
  permissions
}: {
  section: Section
  permissions: PermissionKey[]
}): React.JSX.Element {
  const managePermission: PermissionKey =
    section === 'Plans'
      ? 'plans.manage'
      : section === 'Subscribers'
        ? 'subscribers.manage'
        : 'service_accounts.manage'
  const canManage = permissions.includes(managePermission)
  const [view, setView] = useState<ViewState>({ mode: 'list' })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PageResult<RecordValue> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [selectedSubscriberId, setSelectedSubscriberId] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<ServiceAccountStatus>('active')
  const [accountRelationships, setAccountRelationships] = useState<{
    subscriber: string
    plan: string
  } | null>(null)
  const listRequestId = useRef(0)
  const detailRequestId = useRef(0)
  const editingAccount =
    section === 'Service Accounts' && view.mode === 'edit' ? (view.record as ServiceAccount) : null

  const fetchList = useCallback(async (): Promise<PageResult<RecordValue>> => {
    if (section === 'Plans') {
      return window.api.listPlans({ page, limit: pageSize, q: query || undefined })
    }
    if (section === 'Subscribers') {
      return window.api.listSubscribers({ page, limit: pageSize, q: query || undefined })
    }
    return window.api.listServiceAccounts({
      page,
      limit: pageSize,
      q: query || undefined,
      status: (statusFilter || undefined) as ServiceAccountStatus | undefined
    })
  }, [page, query, section, statusFilter])

  const loadList = useCallback(async (): Promise<void> => {
    const requestId = ++listRequestId.current
    try {
      const response = await fetchList()
      if (requestId === listRequestId.current) setResult(response)
    } catch (loadError: unknown) {
      if (requestId === listRequestId.current) setError(errorMessage(loadError))
    } finally {
      if (requestId === listRequestId.current) setLoading(false)
    }
  }, [fetchList])

  useEffect(
    () => () => {
      listRequestId.current += 1
      detailRequestId.current += 1
    },
    []
  )

  useEffect(() => {
    if (view.mode !== 'list') return
    const requestId = ++listRequestId.current
    let active = true
    const load = async (): Promise<void> => {
      try {
        const response = await fetchList()
        if (active && requestId === listRequestId.current) setResult(response)
      } catch (loadError: unknown) {
        if (active && requestId === listRequestId.current) setError(errorMessage(loadError))
      } finally {
        if (active && requestId === listRequestId.current) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
      if (requestId === listRequestId.current) listRequestId.current += 1
    }
  }, [fetchList, view.mode])

  useEffect(() => {
    if (section !== 'Service Accounts' || (view.mode !== 'create' && view.mode !== 'edit')) return
    let active = true
    Promise.all([
      loadEveryPage((page) => window.api.listPlans({ page, limit: 100, enabled: 'true' })),
      loadEveryPage((page) => window.api.listSubscribers({ page, limit: 100 }))
    ])
      .then(async ([loadedPlans, loadedSubscribers]) => {
        let availablePlans = loadedPlans
        let availableSubscribers = loadedSubscribers
        if (editingAccount) {
          if (!availablePlans.some((plan) => plan.id === editingAccount.planId)) {
            availablePlans = [...availablePlans, await window.api.getPlan(editingAccount.planId)]
          }
          if (
            !availableSubscribers.some(
              (subscriber) => subscriber.id === editingAccount.subscriberId
            )
          ) {
            availableSubscribers = [
              ...availableSubscribers,
              await window.api.getSubscriber(editingAccount.subscriberId)
            ]
          }
        }
        return [availablePlans, availableSubscribers] as const
      })
      .then(([availablePlans, availableSubscribers]) => {
        if (active) {
          setPlans(availablePlans)
          setSubscribers(availableSubscribers)
        }
      })
      .catch((optionsError: unknown) => {
        if (active) setError(errorMessage(optionsError))
      })
      .finally(() => {
        if (active) setOptionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [editingAccount, section, view.mode])

  async function openDetail(id: string): Promise<void> {
    const requestId = ++detailRequestId.current
    setLoading(true)
    setError(null)
    try {
      const record =
        section === 'Plans'
          ? await window.api.getPlan(id)
          : section === 'Subscribers'
            ? await window.api.getSubscriber(id)
            : await window.api.getServiceAccount(id)
      if (section === 'Service Accounts') {
        const account = record as ServiceAccount
        const [subscriber, plan] = await Promise.all([
          window.api.getSubscriber(account.subscriberId),
          window.api.getPlan(account.planId)
        ])
        if (requestId === detailRequestId.current) {
          setAccountRelationships({ subscriber: subscriber.name, plan: plan.name })
        }
      } else {
        setAccountRelationships(null)
      }
      if (requestId === detailRequestId.current) setView({ mode: 'detail', record })
    } catch (detailError: unknown) {
      if (requestId === detailRequestId.current) setError(errorMessage(detailError))
    } finally {
      if (requestId === detailRequestId.current) setLoading(false)
    }
  }

  async function deleteCurrentRecord(): Promise<void> {
    if (view.mode !== 'detail' || !canManage) return
    const noun =
      section === 'Service Accounts' ? 'service account' : section.slice(0, -1).toLowerCase()
    if (
      !window.confirm(
        `Delete this ${noun}? Records referenced by accounts or billing history cannot be deleted.`
      )
    )
      return
    setSaving(true)
    setError(null)
    try {
      if (section === 'Plans') await window.api.deletePlan((view.record as Plan).id)
      else if (section === 'Subscribers')
        await window.api.deleteSubscriber((view.record as Subscriber).id)
      else await window.api.deleteServiceAccount((view.record as ServiceAccount).id)
      setView({ mode: 'list' })
      setSuccess(`${noun} deleted successfully.`)
      setLoading(true)
      await loadList()
    } catch (deleteError: unknown) {
      setError(errorMessage(deleteError))
    } finally {
      setSaving(false)
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setValidationError(null)
    setError(null)
    setSuccess(null)

    const form = new FormData(event.currentTarget)

    setSaving(true)

    try {
      if (section === 'Plans') {
        const payload = {
          name: field(form, 'name'),
          description: optional(field(form, 'description')),
          price: field(form, 'price'),
          enabled: form.get('enabled') === 'on'
        }

        const parsed = planCreateSchema.safeParse(payload)

        if (!parsed.success) {
          setValidationError(parsed.error.issues[0]?.message ?? 'Check the form values.')
          return
        }

        if (view.mode === 'edit') {
          await window.api.updatePlan((view.record as Plan).id, parsed.data)
        } else {
          await window.api.createPlan(parsed.data)
        }
      } else if (section === 'Subscribers') {
        const payload = {
          name: field(form, 'name'),
          email: optional(field(form, 'email')),
          phone: optional(field(form, 'phone')),
          addressLine1: field(form, 'addressLine1'),
          addressLine2: optional(field(form, 'addressLine2')),
          city: field(form, 'city'),
          province: field(form, 'province'),
          postalCode: optional(field(form, 'postalCode'))
        }

        const parsed = subscriberCreateSchema.safeParse(payload)

        if (!parsed.success) {
          setValidationError(parsed.error.issues[0]?.message ?? 'Check the form values.')
          return
        }

        if (view.mode === 'edit') {
          await window.api.updateSubscriber((view.record as Subscriber).id, parsed.data)
        } else {
          await window.api.createSubscriber(parsed.data)
        }
      } else {
        const payload = {
          accountIdentifier: field(form, 'accountIdentifier'),
          subscriberId: field(form, 'subscriberId'),
          planId: field(form, 'planId'),
          status: field(form, 'status')
        }

        const parsed = serviceAccountCreateSchema.safeParse(payload)

        if (!parsed.success) {
          setValidationError(parsed.error.issues[0]?.message ?? 'Check the form values.')
          return
        }

        if (view.mode === 'edit') {
          const updatedRecord = await window.api.updateServiceAccount(
            (view.record as ServiceAccount).id,
            parsed.data
          )
          setView({ mode: 'detail', record: updatedRecord })
          setSuccess('Service account updated successfully.')
          await loadList()
          return
        } else {
          await window.api.createServiceAccount(parsed.data)
        }
      }

      setView({ mode: 'list' })
      setLoading(true)
      setSuccess(
        `${section.slice(0, -1)} ${view.mode === 'edit' ? 'updated' : 'created'} successfully.`
      )
      await loadList()
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const heading =
    view.mode === 'create'
      ? `New ${section.slice(0, -1)}`
      : view.mode === 'edit'
        ? `Edit ${section.slice(0, -1)}`
        : section
  const record = view.mode === 'detail' || view.mode === 'edit' ? view.record : null

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            Management
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-foreground">
            {view.mode === 'detail' ? `${section.slice(0, -1)} details` : heading}
          </h1>
          {view.mode === 'list' && (
            <p className="mt-2 text-sm text-muted-foreground">
              View and manage {section.toLowerCase()}.
            </p>
          )}
        </div>
        {view.mode === 'list' && canManage ? (
          <button
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-blue-700 disabled:opacity-50"
            onClick={() => {
              setError(null)
              setValidationError(null)
              setSelectedPlanId('')
              setSelectedSubscriberId('')
              setSelectedStatus('active')
              if (section === 'Service Accounts') setOptionsLoading(true)
              setView({ mode: 'create' })
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add {section.slice(0, -1)}
          </button>
        ) : view.mode !== 'list' ? (
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
            onClick={() => {
              setError(null)
              setValidationError(null)
              setLoading(true)
              setView({ mode: 'list' })
            }}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </button>
        ) : null}
      </div>

      {error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (view.mode === 'list' || view.mode === 'detail') && (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          role="status"
        >
          {success}
        </p>
      )}

      {view.mode === 'list' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block min-w-[240px] flex-1">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                aria-label={`Search ${section.toLowerCase()}`}
                className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                onChange={(event) => {
                  setPage(1)
                  setLoading(true)
                  setError(null)
                  setQuery(event.target.value)
                }}
                placeholder={`Search ${section.toLowerCase()}…`}
                value={query}
              />
            </label>
            {section === 'Service Accounts' && (
              <select
                aria-label="Filter by status"
                className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                onChange={(event) => {
                  setPage(1)
                  setLoading(true)
                  setError(null)
                  setStatusFilter(event.target.value)
                }}
                value={statusFilter}
              >
                <option value="">All statuses</option>
                {serviceAccountStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {(section === 'Plans'
                      ? ['Plan', 'Price', 'Status']
                      : section === 'Subscribers'
                        ? ['Subscriber', 'Email', 'Phone', 'Location']
                        : ['Account', 'Subscriber ID', 'Plan ID', 'Status']
                    ).map((label) => (
                      <th className="px-5 py-3.5 font-semibold" key={label}>
                        {label}
                      </th>
                    ))}
                    <th className="px-5 py-3.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>
                        <LoaderCircle
                          aria-hidden="true"
                          className="mr-2 inline size-4 animate-spin"
                        />
                        Loading {section.toLowerCase()}…
                      </td>
                    </tr>
                  ) : result?.items.length ? (
                    result.items.map((item) => (
                      <tr className="hover:bg-muted/30" key={item.id}>
                        {section === 'Plans' ? (
                          <>
                            <td className="px-5 py-4">
                              <button
                                className="font-medium text-primary hover:underline"
                                onClick={() => void openDetail(item.id)}
                                type="button"
                              >
                                {(item as Plan).name}
                              </button>
                            </td>
                            <td className="px-5 py-4">{(item as Plan).price}</td>
                            <td className="px-5 py-4">
                              {(item as Plan).enabled ? 'Enabled' : 'Disabled'}
                            </td>
                          </>
                        ) : section === 'Subscribers' ? (
                          <>
                            <td className="px-5 py-4">
                              <button
                                className="font-medium text-primary hover:underline"
                                onClick={() => void openDetail(item.id)}
                                type="button"
                              >
                                {(item as Subscriber).name}
                              </button>
                            </td>
                            <td className="px-5 py-4">{(item as Subscriber).email ?? '—'}</td>
                            <td className="px-5 py-4">{(item as Subscriber).phone ?? '—'}</td>
                            <td className="px-5 py-4">
                              {(item as Subscriber).city}, {(item as Subscriber).province}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-5 py-4">
                              <button
                                className="font-medium text-primary hover:underline"
                                onClick={() => void openDetail(item.id)}
                                type="button"
                              >
                                {(item as ServiceAccount).accountIdentifier}
                              </button>
                            </td>
                            <td className="px-5 py-4 font-mono text-xs">
                              {(item as ServiceAccount).subscriberId}
                            </td>
                            <td className="px-5 py-4 font-mono text-xs">
                              {(item as ServiceAccount).planId}
                            </td>
                            <td className="px-5 py-4 capitalize">
                              {(item as ServiceAccount).status}
                            </td>
                          </>
                        )}
                        <td className="px-5 py-4 text-right">
                          <button
                            className="text-xs font-semibold text-primary hover:underline"
                            onClick={() => void openDetail(item.id)}
                            type="button"
                          >
                            View details
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>
                        {error ? 'Unable to load records.' : 'No records found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{result ? `${result.total} total` : ' '}</span>
              <div className="flex items-center gap-3">
                <span>
                  Page {page}
                  {result ? ` of ${Math.max(1, Math.ceil(result.total / pageSize))}` : ''}
                </span>
                <button
                  aria-label="Previous page"
                  className="rounded p-1 hover:bg-muted disabled:opacity-40"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    setLoading(true)
                    setPage((value) => value - 1)
                  }}
                  type="button"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  aria-label="Next page"
                  className="rounded p-1 hover:bg-muted disabled:opacity-40"
                  disabled={!result || page * pageSize >= result.total || loading}
                  onClick={() => {
                    setLoading(true)
                    setPage((value) => value + 1)
                  }}
                  type="button"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {(view.mode === 'create' || view.mode === 'edit') && (
        <form
          className="max-w-3xl space-y-5 rounded-xl border border-border bg-card p-6 shadow-card"
          onSubmit={(event) => void submit(event)}
        >
          {section === 'Plans' && (
            <>
              <Field
                label="Plan name"
                name="name"
                defaultValue={(record as Plan | null)?.name}
                maxLength={160}
                required
              />
              <Field
                label="Monthly price"
                name="price"
                defaultValue={(record as Plan | null)?.price}
                type="text"
                required
              />
              <p className="-mt-3 text-xs text-muted-foreground">
                Enter a non-negative amount with up to two decimal places.
              </p>
              <label className="block space-y-1.5 text-sm font-medium text-foreground">
                Description
                <textarea
                  className="min-h-24 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                  defaultValue={(record as Plan | null)?.description ?? ''}
                  maxLength={500}
                  name="description"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  defaultChecked={(record as Plan | null)?.enabled ?? true}
                  name="enabled"
                  type="checkbox"
                />
                Enabled
              </label>
            </>
          )}
          {section === 'Subscribers' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                name="name"
                defaultValue={(record as Subscriber | null)?.name}
                maxLength={160}
                required
              />
              <Field
                label="Email"
                name="email"
                defaultValue={(record as Subscriber | null)?.email ?? ''}
                type="email"
                maxLength={254}
              />
              <Field
                label="Phone"
                name="phone"
                defaultValue={(record as Subscriber | null)?.phone ?? ''}
                maxLength={32}
              />
              <Field
                label="Address line 1"
                name="addressLine1"
                defaultValue={(record as Subscriber | null)?.addressLine1}
                maxLength={200}
                required
              />
              <Field
                label="Address line 2"
                name="addressLine2"
                defaultValue={(record as Subscriber | null)?.addressLine2 ?? ''}
                maxLength={200}
              />
              <Field
                label="City"
                name="city"
                defaultValue={(record as Subscriber | null)?.city}
                maxLength={100}
                required
              />
              <Field
                label="Province"
                name="province"
                defaultValue={(record as Subscriber | null)?.province}
                maxLength={100}
                required
              />
              <Field
                label="Postal code"
                name="postalCode"
                defaultValue={(record as Subscriber | null)?.postalCode ?? ''}
                maxLength={20}
              />
            </div>
          )}
          {section === 'Service Accounts' &&
            (optionsLoading ? (
              <p className="text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 inline size-4 animate-spin" />
                Loading subscribers and plans…
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Account identifier"
                  name="accountIdentifier"
                  defaultValue={(record as ServiceAccount | null)?.accountIdentifier}
                  maxLength={64}
                  required
                />
                <SelectField
                  label="Subscriber"
                  name="subscriberId"
                  value={selectedSubscriberId}
                  onChange={setSelectedSubscriberId}
                  options={subscribers.map((subscriber) => ({
                    value: subscriber.id,
                    label: subscriber.name
                  }))}
                />
                <SelectField
                  label="Plan"
                  name="planId"
                  value={selectedPlanId}
                  onChange={setSelectedPlanId}
                  options={plans.map((plan) => ({
                    value: plan.id,
                    label: `${plan.name} — ${plan.price}`
                  }))}
                />
                <SelectField
                  label="Status"
                  name="status"
                  value={selectedStatus}
                  onChange={(value) => setSelectedStatus(value as ServiceAccountStatus)}
                  options={serviceAccountStatuses.map((status) => ({
                    value: status,
                    label: status
                  }))}
                />
              </div>
            ))}
          {validationError && (
            <p
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              role="alert"
            >
              {validationError}
            </p>
          )}
          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <button
              className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
              onClick={() => setView({ mode: 'list' })}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
              disabled={
                saving ||
                (section === 'Service Accounts' &&
                  (optionsLoading || !plans.length || !subscribers.length))
              }
              type="submit"
            >
              {saving ? 'Saving…' : view.mode === 'edit' ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {view.mode === 'detail' && (
        <div className="max-w-3xl rounded-xl border border-border bg-card p-6 shadow-card">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {section === 'Plans' &&
              Object.entries({
                Name: (record as Plan).name,
                Description: (record as Plan).description ?? '—',
                Price: (record as Plan).price,
                Status: (record as Plan).enabled ? 'Enabled' : 'Disabled',
                'Created at': (record as Plan).createdAt
              }).map(([label, value]) => <Detail key={label} label={label} value={value} />)}
            {section === 'Subscribers' &&
              Object.entries({
                Name: (record as Subscriber).name,
                Email: (record as Subscriber).email ?? '—',
                Phone: (record as Subscriber).phone ?? '—',
                'Address line 1': (record as Subscriber).addressLine1,
                'Address line 2': (record as Subscriber).addressLine2 ?? '—',
                City: (record as Subscriber).city,
                Province: (record as Subscriber).province,
                'Postal code': (record as Subscriber).postalCode ?? '—',
                'Created at': (record as Subscriber).createdAt
              }).map(([label, value]) => <Detail key={label} label={label} value={value} />)}
            {section === 'Service Accounts' &&
              Object.entries({
                'Account identifier': (record as ServiceAccount).accountIdentifier,
                Subscriber:
                  accountRelationships?.subscriber ?? (record as ServiceAccount).subscriberId,
                Plan: accountRelationships?.plan ?? (record as ServiceAccount).planId,
                Status: (record as ServiceAccount).status,
                'Created at': (record as ServiceAccount).createdAt
              }).map(([label, value]) => <Detail key={label} label={label} value={value} />)}
          </dl>
          {canManage && (
            <div className="mt-6 flex justify-between border-t border-border pt-4">
              <button
                className="h-10 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
                disabled={saving}
                onClick={() => void deleteCurrentRecord()}
                type="button"
              >
                {saving ? 'Deleting…' : 'Delete'}
              </button>
              <button
                className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-blue-700"
                onClick={() => {
                  setValidationError(null)
                  if (section === 'Service Accounts') {
                    const account = view.record as ServiceAccount
                    setOptionsLoading(true)
                    setSelectedSubscriberId(account.subscriberId)
                    setSelectedPlanId(account.planId)
                    setSelectedStatus(account.status)
                  }
                  setView({ mode: 'edit', record: view.record })
                }}
                type="button"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm text-foreground">{value}</dd>
    </div>
  )
}
