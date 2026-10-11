import { sql } from 'drizzle-orm'
import {
  check,
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    loginIdentifier: varchar('login_identifier', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('users_login_identifier_unique').on(table.loginIdentifier),
    check(
      'users_login_identifier_normalized_check',
      sql`${table.loginIdentifier} = lower(btrim(${table.loginIdentifier}))`
    ),
    check(
      'users_login_identifier_not_empty_check',
      sql`length(${table.loginIdentifier}) > 0`
    ),
    check('users_status_check', sql`${table.status} IN ('active', 'disabled')`)
  ]
)

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('roles_name_unique').on(table.name),
    check(
      'roles_name_check',
      sql`${table.name} IN ('Administrator', 'Registrar / Staff', 'Instructor', 'Student')`
    )
  ]
)

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('permissions_key_unique').on(table.key),
    check(
      'permissions_key_check',
      sql`${table.key} IN ('users.read', 'users.manage', 'roles.manage', 'permissions.manage', 'plans.read', 'plans.manage', 'subscribers.read', 'subscribers.manage', 'service_accounts.read', 'service_accounts.manage', 'invoices.read', 'invoices.manage')`
    )
  ]
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_role_id_idx').on(table.roleId)
  ]
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('role_permissions_permission_id_idx').on(table.permissionId)
  ]
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_expires_at_idx').on(table.userId, table.expiresAt),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check(
      'sessions_token_hash_format_check',
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`
    )
  ]
)

export const loginRateLimitBuckets = pgTable(
  'login_rate_limit_buckets',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),
    attemptCount: integer('attempt_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('login_rate_limit_buckets_window_started_at_idx').on(
      table.windowStartedAt
    ),
    check(
      'login_rate_limit_buckets_key_hash_check',
      sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'login_rate_limit_buckets_attempt_count_check',
      sql`${table.attemptCount} > 0`
    )
  ]
)

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    price: numeric('price', {
      precision: 12,
      scale: 2,
      mode: 'string'
    }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('plans_name_idx').on(table.name),
    check('plans_name_not_empty_check', sql`length(btrim(${table.name})) > 0`),
    check('plans_price_nonnegative_check', sql`${table.price} >= 0`)
  ]
)

export const subscribers = pgTable(
  'subscribers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 32 }),
    addressLine1: varchar('address_line_1', { length: 200 }).notNull(),
    addressLine2: varchar('address_line_2', { length: 200 }),
    city: varchar('city', { length: 100 }).notNull(),
    province: varchar('province', { length: 100 }).notNull(),
    postalCode: varchar('postal_code', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('subscribers_name_idx').on(table.name),
    index('subscribers_email_idx').on(table.email),
    index('subscribers_phone_idx').on(table.phone),
    check(
      'subscribers_name_not_empty_check',
      sql`length(btrim(${table.name})) > 0`
    )
  ]
)

export const serviceAccounts = pgTable(
  'service_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountIdentifier: varchar('account_identifier', { length: 64 }).notNull(),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => subscribers.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('service_accounts_identifier_unique').on(
      table.accountIdentifier
    ),
    index('service_accounts_subscriber_id_idx').on(table.subscriberId),
    index('service_accounts_plan_id_idx').on(table.planId),
    index('service_accounts_status_idx').on(table.status),
    check(
      'service_accounts_identifier_not_empty_check',
      sql`length(btrim(${table.accountIdentifier})) > 0`
    ),
    check(
      'service_accounts_status_check',
      sql`${table.status} IN ('active', 'suspended', 'cancelled')`
    )
  ]
)

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 64 }).notNull(),
    serviceAccountId: uuid('service_account_id')
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    accountIdentifier: varchar('account_identifier_snapshot', {
      length: 64
    }).notNull(),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => subscribers.id, { onDelete: 'restrict' }),
    subscriberName: varchar('subscriber_name_snapshot', {
      length: 160
    }).notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    planName: varchar('plan_name_snapshot', { length: 160 }).notNull(),
    billingPeriodStart: date('billing_period_start', {
      mode: 'string'
    }).notNull(),
    billingPeriodEnd: date('billing_period_end', { mode: 'string' }).notNull(),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    subtotal: numeric('subtotal', {
      precision: 12,
      scale: 2,
      mode: 'string'
    }).notNull(),
    total: numeric('total', {
      precision: 12,
      scale: 2,
      mode: 'string'
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('invoices_number_unique').on(table.invoiceNumber),
    uniqueIndex('invoices_service_account_period_unique').on(
      table.serviceAccountId,
      table.billingPeriodStart
    ),
    index('invoices_period_idx').on(table.billingPeriodStart),
    index('invoices_subscriber_idx').on(table.subscriberId),
    index('invoices_due_date_idx').on(table.dueDate),
    check(
      'invoices_amounts_nonnegative_check',
      sql`${table.subtotal} >= 0 AND ${table.total} >= 0`
    ),
    check(
      'invoices_period_check',
      sql`${table.billingPeriodEnd} >= ${table.billingPeriodStart}`
    ),
    check(
      'invoices_due_date_check',
      sql`${table.dueDate} >= ${table.issueDate}`
    )
  ]
)

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    description: varchar('description', { length: 240 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', {
      precision: 12,
      scale: 2,
      mode: 'string'
    }).notNull(),
    lineTotal: numeric('line_total', {
      precision: 12,
      scale: 2,
      mode: 'string'
    }).notNull()
  },
  (table) => [
    index('invoice_items_invoice_id_idx').on(table.invoiceId),
    check('invoice_items_quantity_positive_check', sql`${table.quantity} > 0`),
    check(
      'invoice_items_amounts_nonnegative_check',
      sql`${table.unitPrice} >= 0 AND ${table.lineTotal} >= 0`
    )
  ]
)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amount: numeric('amount', {
      precision: 12,
      scale: 2,
      mode: 'string'
    }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('payments_invoice_id_idx').on(table.invoiceId),
    index('payments_received_at_idx').on(table.receivedAt),
    check('payments_amount_positive_check', sql`${table.amount} > 0`)
  ]
)
