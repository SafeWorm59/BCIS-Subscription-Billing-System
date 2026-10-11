import { z } from 'zod'

export const roleNames = [
  'Administrator',
  'Registrar / Staff',
  'Instructor',
  'Student'
] as const

export const permissionKeys = [
  'users.read',
  'users.manage',
  'roles.manage',
  'permissions.manage',
  'plans.read',
  'plans.manage',
  'subscribers.read',
  'subscribers.manage',
  'service_accounts.read',
  'service_accounts.manage',
  'invoices.read',
  'invoices.manage'
] as const

export const userStatuses = ['active', 'disabled'] as const
export const serviceAccountStatuses = [
  'active',
  'suspended',
  'cancelled'
] as const

export const roleNameSchema = z.enum(roleNames)
export type RoleName = z.infer<typeof roleNameSchema>

export const permissionKeySchema = z.enum(permissionKeys)
export type PermissionKey = z.infer<typeof permissionKeySchema>

export const userStatusSchema = z.enum(userStatuses)
export type UserStatus = z.infer<typeof userStatusSchema>

export const serviceAccountStatusSchema = z.enum(serviceAccountStatuses)
export type ServiceAccountStatus = z.infer<typeof serviceAccountStatusSchema>

export const invoiceStatuses = [
  'unpaid',
  'partially_paid',
  'paid',
  'overdue'
] as const
export const invoiceStatusSchema = z.enum(invoiceStatuses)
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>
export const invoiceListStatusSchema = z.enum([
  ...invoiceStatuses,
  'outstanding'
])

const uuidSchema = z.uuid()
const nameSchema = z.string().trim().min(1).max(160)
const optionalTextSchema = z.string().trim().max(500).nullable().optional()
const moneySchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
    'Expected a non-negative amount with at most two decimal places'
  )

export const planCreateSchema = z
  .object({
    name: nameSchema,
    description: optionalTextSchema,
    price: moneySchema,
    enabled: z.boolean().default(true)
  })
  .strict()

export const planUpdateSchema = planCreateSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field must be provided'
  )
  .strict()

export const planSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    description: z.string().nullable(),
    price: moneySchema,
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const subscriberCreateSchema = z
  .object({
    name: nameSchema,
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: z.string().trim().min(1).max(32).nullable().optional(),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(1).max(100),
    province: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().max(20).nullable().optional()
  })
  .strict()

export const subscriberUpdateSchema = subscriberCreateSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field must be provided'
  )
  .strict()

export const subscriberSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    email: z.string().nullable(),
    phone: z.string().nullable(),
    addressLine1: z.string(),
    addressLine2: z.string().nullable(),
    city: z.string(),
    province: z.string(),
    postalCode: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const serviceAccountCreateSchema = z
  .object({
    accountIdentifier: z.string().trim().min(1).max(64),
    subscriberId: uuidSchema,
    planId: uuidSchema,
    status: serviceAccountStatusSchema.default('active')
  })
  .strict()

export const serviceAccountUpdateSchema = serviceAccountCreateSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field must be provided'
  )
  .strict()

export const serviceAccountSchema = z
  .object({
    id: uuidSchema,
    accountIdentifier: z.string(),
    subscriberId: uuidSchema,
    planId: uuidSchema,
    status: serviceAccountStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const entityListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(160).optional()
  })
  .strict()

export const planListQuerySchema = entityListQuerySchema
  .extend({
    enabled: z.enum(['true', 'false']).optional()
  })
  .strict()

export const serviceAccountListQuerySchema = entityListQuerySchema
  .extend({
    status: serviceAccountStatusSchema.optional(),
    subscriberId: uuidSchema.optional(),
    planId: uuidSchema.optional()
  })
  .strict()

export function createListResponseSchema<T extends z.ZodType>(item: T) {
  return z
    .object({
      items: z.array(item),
      page: z.number().int().min(1),
      limit: z.number().int().min(1),
      total: z.number().int().min(0)
    })
    .strict()
}

export const planListResponseSchema = createListResponseSchema(planSchema)
export const subscriberListResponseSchema =
  createListResponseSchema(subscriberSchema)
export const serviceAccountListResponseSchema =
  createListResponseSchema(serviceAccountSchema)

export type Plan = z.infer<typeof planSchema>
export type PlanCreate = z.infer<typeof planCreateSchema>
export type PlanUpdate = z.infer<typeof planUpdateSchema>
export type Subscriber = z.infer<typeof subscriberSchema>
export type SubscriberCreate = z.infer<typeof subscriberCreateSchema>
export type SubscriberUpdate = z.infer<typeof subscriberUpdateSchema>
export type ServiceAccount = z.infer<typeof serviceAccountSchema>
export type ServiceAccountCreate = z.infer<typeof serviceAccountCreateSchema>
export type ServiceAccountUpdate = z.infer<typeof serviceAccountUpdateSchema>
export type EntityListQuery = z.infer<typeof entityListQuerySchema>
export type PlanListQuery = z.infer<typeof planListQuerySchema>
export type ServiceAccountListQuery = z.infer<
  typeof serviceAccountListQuerySchema
>

const dateSchema = z.iso.date()

function monthEnd(start: string): string {
  const [year, month] = start.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  return `${start.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
}

function isMonthStart(start: string): boolean {
  return start.endsWith('-01')
}

function isMonthRange(start: string, end: string): boolean {
  return isMonthStart(start) && end === monthEnd(start)
}

export const invoiceGenerateSchema = z
  .object({
    serviceAccountId: uuidSchema,
    billingPeriodStart: dateSchema,
    issueDate: dateSchema,
    dueDate: dateSchema
  })
  .strict()
  .refine((value) => isMonthStart(value.billingPeriodStart), {
    message: 'Billing period must start on the first day of a month',
    path: ['billingPeriodStart']
  })
  .refine((value) => value.dueDate >= value.issueDate, {
    message: 'Due date must be on or after the issue date',
    path: ['dueDate']
  })

export const invoiceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(160).optional(),
    status: invoiceListStatusSchema.optional(),
    billingPeriodStart: dateSchema.optional(),
    billingPeriodEnd: dateSchema.optional()
  })
  .strict()
  .refine(
    (value) =>
      (value.billingPeriodStart === undefined) ===
        (value.billingPeriodEnd === undefined) &&
      (value.billingPeriodStart === undefined ||
        isMonthRange(value.billingPeriodStart, value.billingPeriodEnd!)),
    { message: 'Billing period must be a complete calendar month' }
  )

export const billingSummaryQuerySchema = z
  .object({ billingPeriodStart: dateSchema, billingPeriodEnd: dateSchema })
  .strict()
  .refine(
    (value) => isMonthRange(value.billingPeriodStart, value.billingPeriodEnd),
    {
      message: 'Billing period must be a complete calendar month'
    }
  )

export const invoiceLineItemSchema = z
  .object({
    id: uuidSchema,
    description: z.string().min(1).max(240),
    quantity: z.number().int().positive(),
    unitPrice: moneySchema,
    lineTotal: moneySchema
  })
  .strict()

export const invoiceSchema = z
  .object({
    id: uuidSchema,
    invoiceNumber: z.string().min(1).max(64),
    serviceAccountId: uuidSchema,
    accountIdentifier: z.string().min(1),
    subscriberId: uuidSchema,
    subscriberName: nameSchema,
    planId: uuidSchema,
    planName: nameSchema,
    billingPeriodStart: dateSchema,
    billingPeriodEnd: dateSchema,
    issueDate: dateSchema,
    dueDate: dateSchema,
    subtotal: moneySchema,
    total: moneySchema,
    amountPaid: moneySchema,
    balance: moneySchema,
    status: invoiceStatusSchema,
    lineItems: z.array(invoiceLineItemSchema),
    createdAt: z.iso.datetime()
  })
  .strict()

export const invoiceListItemSchema = invoiceSchema.omit({ lineItems: true })
export const invoiceListResponseSchema = createListResponseSchema(
  invoiceListItemSchema
)

export const billingSummarySchema = z
  .object({
    billingPeriodStart: dateSchema,
    billingPeriodEnd: dateSchema,
    totalBilled: moneySchema,
    totalCollected: moneySchema,
    totalOutstanding: moneySchema,
    unpaidInvoiceCount: z.number().int().nonnegative(),
    overdueInvoiceCount: z.number().int().nonnegative(),
    recentInvoices: z.array(invoiceListItemSchema)
  })
  .strict()

export type InvoiceGenerate = z.infer<typeof invoiceGenerateSchema>
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>
export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>
export type Invoice = z.infer<typeof invoiceSchema>
export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>

export const paymentCreateSchema = z
  .object({
    id: uuidSchema,
    amount: moneySchema.refine(
      (value) => Number(value) > 0,
      'Payment must be greater than zero'
    )
  })
  .strict()
export const paymentSchema = z
  .object({
    id: uuidSchema,
    invoiceId: uuidSchema,
    amount: moneySchema,
    receivedAt: z.iso.datetime()
  })
  .strict()
export const paymentListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(160).optional(),
    receivedAtStart: dateSchema.optional(),
    receivedAtEnd: dateSchema.optional()
  })
  .strict()
  .refine(
    (value) =>
      value.receivedAtStart === undefined ||
      value.receivedAtEnd === undefined ||
      value.receivedAtStart <= value.receivedAtEnd,
    { message: 'Payment start date must be on or before the end date' }
  )
export const paymentListItemSchema = z
  .object({
    id: uuidSchema,
    invoiceId: uuidSchema,
    invoiceNumber: z.string().min(1).max(64),
    accountIdentifier: z.string().min(1),
    subscriberName: nameSchema,
    amount: moneySchema,
    receivedAt: z.iso.datetime()
  })
  .strict()
export const paymentListResponseSchema = createListResponseSchema(
  paymentListItemSchema
)
export type PaymentCreate = z.infer<typeof paymentCreateSchema>
export type Payment = z.infer<typeof paymentSchema>
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>
export type PaymentListItem = z.infer<typeof paymentListItemSchema>
export type BillingSummaryQuery = z.infer<typeof billingSummaryQuerySchema>
export type BillingSummary = z.infer<typeof billingSummarySchema>

export const healthResponseSchema = z.object({
  status: z.literal('healthy')
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const loginRequestSchema = z
  .object({
    loginIdentifier: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .transform((identifier) => identifier.toLowerCase()),
    password: z.string().min(1).max(1024)
  })
  .strict()

export type LoginRequest = z.infer<typeof loginRequestSchema>

export const safeAuthenticatedUserSchema = z
  .object({
    id: z.uuid(),
    loginIdentifier: z.string(),
    status: userStatusSchema,
    roles: z.array(roleNameSchema),
    permissions: z.array(permissionKeySchema)
  })
  .strict()

export type SafeAuthenticatedUser = z.infer<typeof safeAuthenticatedUserSchema>

export const currentUserResponseSchema = z
  .object({
    user: safeAuthenticatedUserSchema
  })
  .strict()

export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>

export const adminUserSchema = safeAuthenticatedUserSchema
  .extend({ createdAt: z.iso.datetime() })
  .strict()
export const adminUserListResponseSchema = z
  .object({ users: z.array(adminUserSchema) })
  .strict()
export const roleAdministrationSchema = z
  .object({ name: roleNameSchema, permissions: z.array(permissionKeySchema) })
  .strict()
export const roleAdministrationListSchema = z
  .object({ roles: z.array(roleAdministrationSchema) })
  .strict()
export const userCreateAdminSchema = z
  .object({
    loginIdentifier: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(1024),
    roles: z.array(roleNameSchema).min(1)
  })
  .strict()
export const userUpdateAdminSchema = z
  .object({
    status: userStatusSchema.optional(),
    roles: z.array(roleNameSchema).min(1).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)
export const rolePermissionsUpdateSchema = z
  .object({ permissions: z.array(permissionKeySchema) })
  .strict()
export type AdminUser = z.infer<typeof adminUserSchema>

export const authenticationErrorResponseSchema = z
  .object({
    error: z.string().min(1)
  })
  .strict()

export type AuthenticationErrorResponse = z.infer<
  typeof authenticationErrorResponseSchema
>
