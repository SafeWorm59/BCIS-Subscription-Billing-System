import {
  authenticationErrorResponseSchema,
  billingSummaryQuerySchema,
  billingSummarySchema,
  entityListQuerySchema,
  invoiceGenerateSchema,
  invoiceListQuerySchema,
  invoiceListResponseSchema,
  invoiceSchema,
  paymentCreateSchema,
  paymentListQuerySchema,
  paymentListResponseSchema,
  paymentSchema,
  planCreateSchema,
  planListQuerySchema,
  planListResponseSchema,
  planSchema,
  planUpdateSchema,
  serviceAccountCreateSchema,
  serviceAccountListQuerySchema,
  serviceAccountListResponseSchema,
  serviceAccountSchema,
  serviceAccountUpdateSchema,
  subscriberCreateSchema,
  subscriberListResponseSchema,
  subscriberSchema,
  subscriberUpdateSchema,
  type EntityListQuery,
  type BillingSummary,
  type BillingSummaryQuery,
  type Invoice,
  type InvoiceGenerate,
  type InvoiceListItem,
  type InvoiceListQuery,
  type Payment,
  type PaymentCreate,
  type PaymentListItem,
  type PaymentListQuery,
  type Plan,
  type PlanCreate,
  type PlanListQuery,
  type PlanUpdate,
  type ServiceAccount,
  type ServiceAccountCreate,
  type ServiceAccountListQuery,
  type ServiceAccountUpdate,
  type Subscriber,
  type SubscriberCreate,
  type SubscriberUpdate
} from '@bcis/shared'
import { z } from 'zod'

type BusinessFetch = (input: string, init: RequestInit) => Promise<Response>

export class BusinessApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'BusinessApiError'
  }
}

export interface BusinessApi {
  listPlans(query: PlanListQuery): Promise<ReturnTypeOfPlanList>
  getPlan(id: string): Promise<Plan>
  createPlan(input: PlanCreate): Promise<Plan>
  updatePlan(id: string, input: PlanUpdate): Promise<Plan>
  deletePlan(id: string): Promise<void>
  listSubscribers(query: EntityListQuery): Promise<ReturnTypeOfSubscriberList>
  getSubscriber(id: string): Promise<Subscriber>
  createSubscriber(input: SubscriberCreate): Promise<Subscriber>
  updateSubscriber(id: string, input: SubscriberUpdate): Promise<Subscriber>
  deleteSubscriber(id: string): Promise<void>
  listServiceAccounts(query: ServiceAccountListQuery): Promise<ReturnTypeOfServiceAccountList>
  getServiceAccount(id: string): Promise<ServiceAccount>
  createServiceAccount(input: ServiceAccountCreate): Promise<ServiceAccount>
  updateServiceAccount(id: string, input: ServiceAccountUpdate): Promise<ServiceAccount>
  deleteServiceAccount(id: string): Promise<void>
  listInvoices(query: InvoiceListQuery): Promise<{
    items: InvoiceListItem[]
    page: number
    limit: number
    total: number
  }>
  getInvoice(id: string): Promise<Invoice>
  generateInvoice(input: InvoiceGenerate): Promise<Invoice>
  getBillingSummary(query: BillingSummaryQuery): Promise<BillingSummary>
  listInvoicePayments(id: string): Promise<Payment[]>
  listPayments(query: PaymentListQuery): Promise<{
    items: PaymentListItem[]
    page: number
    limit: number
    total: number
  }>
  recordInvoicePayment(id: string, input: PaymentCreate): Promise<Payment>
}

type ReturnTypeOfPlanList = {
  items: Plan[]
  page: number
  limit: number
  total: number
}
type ReturnTypeOfSubscriberList = {
  items: Subscriber[]
  page: number
  limit: number
  total: number
}
type ReturnTypeOfServiceAccountList = {
  items: ServiceAccount[]
  page: number
  limit: number
  total: number
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error('BCIS API returned an unreadable response.')
  }
}

async function throwResponseError(response: Response): Promise<never> {
  let message = `BCIS request failed (HTTP ${response.status}).`
  try {
    const parsed = authenticationErrorResponseSchema.safeParse(await response.json())
    if (parsed.success) message = parsed.data.error
  } catch {
    // Preserve the HTTP status when the API response is not JSON.
  }
  throw new BusinessApiError(message, response.status)
}

function queryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function createBusinessApi(
  fetcher: BusinessFetch,
  onUnauthorized?: () => void,
  endpoint: () => string = () => 'http://127.0.0.1:3000'
): BusinessApi {
  async function request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    schema: z.ZodType<T>,
    body?: object
  ): Promise<T> {
    const response = await fetcher(`${endpoint()}/api/v1${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }
        : {})
    })
    if (response.status === 401) onUnauthorized?.()
    if (response.status === 204) return undefined as T
    if (!response.ok) return throwResponseError(response)

    const parsed = schema.safeParse(await readJson(response))
    if (!parsed.success) {
      throw new Error('BCIS API returned a response that did not match its contract.')
    }
    return parsed.data
  }

  return {
    listPlans(query) {
      const parsed = planListQuerySchema.parse(query)
      return request(`/plans${queryString(parsed)}`, 'GET', planListResponseSchema)
    },
    getPlan(id) {
      return request(`/plans/${z.uuid().parse(id)}`, 'GET', planSchema)
    },
    createPlan(input) {
      return request('/plans', 'POST', planSchema, planCreateSchema.parse(input))
    },
    updatePlan(id, input) {
      return request(
        `/plans/${z.uuid().parse(id)}`,
        'PATCH',
        planSchema,
        planUpdateSchema.parse(input)
      )
    },
    deletePlan(id) {
      return request(`/plans/${z.uuid().parse(id)}`, 'DELETE', z.undefined())
    },
    listSubscribers(query) {
      const parsed = entityListQuerySchema.parse(query)
      return request(`/subscribers${queryString(parsed)}`, 'GET', subscriberListResponseSchema)
    },
    getSubscriber(id) {
      return request(`/subscribers/${z.uuid().parse(id)}`, 'GET', subscriberSchema)
    },
    createSubscriber(input) {
      return request('/subscribers', 'POST', subscriberSchema, subscriberCreateSchema.parse(input))
    },
    updateSubscriber(id, input) {
      return request(
        `/subscribers/${z.uuid().parse(id)}`,
        'PATCH',
        subscriberSchema,
        subscriberUpdateSchema.parse(input)
      )
    },
    deleteSubscriber(id) {
      return request(`/subscribers/${z.uuid().parse(id)}`, 'DELETE', z.undefined())
    },
    listServiceAccounts(query) {
      const parsed = serviceAccountListQuerySchema.parse(query)
      return request(
        `/service-accounts${queryString(parsed)}`,
        'GET',
        serviceAccountListResponseSchema
      )
    },
    getServiceAccount(id) {
      return request(`/service-accounts/${z.uuid().parse(id)}`, 'GET', serviceAccountSchema)
    },
    createServiceAccount(input) {
      return request(
        '/service-accounts',
        'POST',
        serviceAccountSchema,
        serviceAccountCreateSchema.parse(input)
      )
    },
    updateServiceAccount(id, input) {
      return request(
        `/service-accounts/${z.uuid().parse(id)}`,
        'PATCH',
        serviceAccountSchema,
        serviceAccountUpdateSchema.parse(input)
      )
    },
    deleteServiceAccount(id) {
      return request(`/service-accounts/${z.uuid().parse(id)}`, 'DELETE', z.undefined())
    },
    listInvoices(query) {
      const parsed = invoiceListQuerySchema.parse(query)
      return request(`/invoices${queryString(parsed)}`, 'GET', invoiceListResponseSchema)
    },
    getInvoice(id) {
      return request(`/invoices/${z.uuid().parse(id)}`, 'GET', invoiceSchema)
    },
    listInvoicePayments(id) {
      return request(`/invoices/${z.uuid().parse(id)}/payments`, 'GET', z.array(paymentSchema))
    },
    listPayments(query) {
      const parsed = paymentListQuerySchema.parse(query)
      return request(`/payments${queryString(parsed)}`, 'GET', paymentListResponseSchema)
    },
    recordInvoicePayment(id, input) {
      return request(
        `/invoices/${z.uuid().parse(id)}/payments`,
        'POST',
        paymentSchema,
        paymentCreateSchema.parse(input)
      )
    },
    generateInvoice(input) {
      return request(
        '/invoices/generate',
        'POST',
        invoiceSchema,
        invoiceGenerateSchema.parse(input)
      )
    },
    getBillingSummary(query) {
      const parsed = billingSummaryQuerySchema.parse(query)
      return request(`/billing/summary${queryString(parsed)}`, 'GET', billingSummarySchema)
    }
  }
}
