import type {
  AdminUser,
  BillingSummary,
  BillingSummaryQuery,
  EntityListQuery,
  Invoice,
  InvoiceGenerate,
  InvoiceListItem,
  InvoiceListQuery,
  Payment,
  PaymentCreate,
  PaymentListItem,
  PaymentListQuery,
  LoginRequest,
  Plan,
  PlanCreate,
  PlanListQuery,
  PlanUpdate,
  SafeAuthenticatedUser,
  RoleName,
  ServiceAccount,
  ServiceAccountCreate,
  ServiceAccountListQuery,
  ServiceAccountUpdate,
  Subscriber,
  SubscriberCreate,
  SubscriberUpdate
} from '@bcis/shared'

declare global {
  interface Window {
    api: {
      onSessionExpired?(listener: () => void): () => void
      login(request: LoginRequest): Promise<SafeAuthenticatedUser>
      getCurrentUser(): Promise<SafeAuthenticatedUser | null>
      logout(): Promise<void>
      getApiEndpoint(): Promise<string>
      updateApiEndpoint(endpoint: string): Promise<{ endpoint: string; changed: boolean }>
      listAdminUsers(): Promise<{ users: AdminUser[] }>
      listAdminRoles(): Promise<{ roles: { name: RoleName; permissions: string[] }[] }>
      createAdminUser(input: {
        loginIdentifier: string
        password: string
        roles: RoleName[]
      }): Promise<void>
      updateAdminUser(
        id: string,
        input: { status?: 'active' | 'disabled'; roles?: RoleName[] }
      ): Promise<void>
      updateAdminRole(name: RoleName, permissions: string[]): Promise<void>
      listPlans(query: PlanListQuery): Promise<{
        items: Plan[]
        page: number
        limit: number
        total: number
      }>
      getPlan(id: string): Promise<Plan>
      createPlan(input: PlanCreate): Promise<Plan>
      updatePlan(id: string, input: PlanUpdate): Promise<Plan>
      deletePlan(id: string): Promise<void>
      listSubscribers(query: EntityListQuery): Promise<{
        items: Subscriber[]
        page: number
        limit: number
        total: number
      }>
      getSubscriber(id: string): Promise<Subscriber>
      createSubscriber(input: SubscriberCreate): Promise<Subscriber>
      updateSubscriber(id: string, input: SubscriberUpdate): Promise<Subscriber>
      deleteSubscriber(id: string): Promise<void>
      listServiceAccounts(query: ServiceAccountListQuery): Promise<{
        items: ServiceAccount[]
        page: number
        limit: number
        total: number
      }>
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
      listInvoicePayments(id: string): Promise<Payment[]>
      listPayments(query: PaymentListQuery): Promise<{
        items: PaymentListItem[]
        page: number
        limit: number
        total: number
      }>
      recordInvoicePayment(id: string, input: PaymentCreate): Promise<Payment>
      generateInvoice(input: InvoiceGenerate): Promise<Invoice>
      getBillingSummary(query: BillingSummaryQuery): Promise<BillingSummary>
      getRuntimeVersions(): {
        electron: string
        chrome: string
        node: string
      }
    }
  }
}

export {}
