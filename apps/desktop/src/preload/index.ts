import { contextBridge, ipcRenderer } from 'electron'
import type {
  AdminUser,
  RoleName,
  EntityListQuery,
  BillingSummaryQuery,
  InvoiceGenerate,
  InvoiceListQuery,
  Payment,
  PaymentCreate,
  PaymentListQuery,
  LoginRequest,
  Plan,
  PlanCreate,
  PlanListQuery,
  PlanUpdate,
  SafeAuthenticatedUser,
  ServiceAccount,
  ServiceAccountCreate,
  ServiceAccountListQuery,
  ServiceAccountUpdate,
  Subscriber,
  SubscriberCreate,
  SubscriberUpdate
} from '@bcis/shared'

const api = {
  onSessionExpired: (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('auth:expired', handler)
    return () => ipcRenderer.removeListener('auth:expired', handler)
  },
  login: (request: LoginRequest): Promise<SafeAuthenticatedUser> =>
    ipcRenderer.invoke('auth:login', request),
  getCurrentUser: (): Promise<SafeAuthenticatedUser | null> =>
    ipcRenderer.invoke('auth:current-user'),
  logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
  getApiEndpoint: (): Promise<string> => ipcRenderer.invoke('settings:api-endpoint:get'),
  updateApiEndpoint: (endpoint: string): Promise<{ endpoint: string; changed: boolean }> =>
    ipcRenderer.invoke('settings:api-endpoint:update', endpoint),
  listAdminUsers: (): Promise<{ users: AdminUser[] }> => ipcRenderer.invoke('admin:users:list'),
  listAdminRoles: (): Promise<{ roles: { name: RoleName; permissions: string[] }[] }> =>
    ipcRenderer.invoke('admin:roles:list'),
  createAdminUser: (input: {
    loginIdentifier: string
    password: string
    roles: RoleName[]
  }): Promise<void> => ipcRenderer.invoke('admin:users:create', input),
  updateAdminUser: (
    id: string,
    input: { status?: 'active' | 'disabled'; roles?: RoleName[] }
  ): Promise<void> => ipcRenderer.invoke('admin:users:update', id, input),
  updateAdminRole: (name: RoleName, permissions: string[]): Promise<void> =>
    ipcRenderer.invoke('admin:roles:update', name, permissions),
  listPlans: (query: PlanListQuery) => ipcRenderer.invoke('business:plans:list', query),
  getPlan: (id: string): Promise<Plan> => ipcRenderer.invoke('business:plans:get', id),
  createPlan: (input: PlanCreate): Promise<Plan> =>
    ipcRenderer.invoke('business:plans:create', input),
  updatePlan: (id: string, input: PlanUpdate): Promise<Plan> =>
    ipcRenderer.invoke('business:plans:update', id, input),
  deletePlan: (id: string): Promise<void> => ipcRenderer.invoke('business:plans:delete', id),
  listSubscribers: (query: EntityListQuery) =>
    ipcRenderer.invoke('business:subscribers:list', query),
  getSubscriber: (id: string): Promise<Subscriber> =>
    ipcRenderer.invoke('business:subscribers:get', id),
  createSubscriber: (input: SubscriberCreate): Promise<Subscriber> =>
    ipcRenderer.invoke('business:subscribers:create', input),
  updateSubscriber: (id: string, input: SubscriberUpdate): Promise<Subscriber> =>
    ipcRenderer.invoke('business:subscribers:update', id, input),
  deleteSubscriber: (id: string): Promise<void> =>
    ipcRenderer.invoke('business:subscribers:delete', id),
  listServiceAccounts: (query: ServiceAccountListQuery) =>
    ipcRenderer.invoke('business:service-accounts:list', query),
  getServiceAccount: (id: string): Promise<ServiceAccount> =>
    ipcRenderer.invoke('business:service-accounts:get', id),
  createServiceAccount: (input: ServiceAccountCreate): Promise<ServiceAccount> =>
    ipcRenderer.invoke('business:service-accounts:create', input),
  updateServiceAccount: (id: string, input: ServiceAccountUpdate): Promise<ServiceAccount> =>
    ipcRenderer.invoke('business:service-accounts:update', id, input),
  deleteServiceAccount: (id: string): Promise<void> =>
    ipcRenderer.invoke('business:service-accounts:delete', id),
  listInvoices: (query: InvoiceListQuery) => ipcRenderer.invoke('business:invoices:list', query),
  getInvoice: (id: string) => ipcRenderer.invoke('business:invoices:get', id),
  listInvoicePayments: (id: string): Promise<Payment[]> =>
    ipcRenderer.invoke('business:invoices:payments:list', id),
  listPayments: (query: PaymentListQuery) => ipcRenderer.invoke('business:payments:list', query),
  recordInvoicePayment: (id: string, input: PaymentCreate): Promise<Payment> =>
    ipcRenderer.invoke('business:invoices:payments:record', id, input),
  generateInvoice: (input: InvoiceGenerate) =>
    ipcRenderer.invoke('business:invoices:generate', input),
  getBillingSummary: (query: BillingSummaryQuery) =>
    ipcRenderer.invoke('business:billing:summary', query),
  getRuntimeVersions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  })
}

contextBridge.exposeInMainWorld('api', api)
