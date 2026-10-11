import { app, shell, BrowserWindow, ipcMain, net, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  billingSummaryQuerySchema,
  entityListQuerySchema,
  invoiceGenerateSchema,
  invoiceListQuerySchema,
  paymentCreateSchema,
  paymentListQuerySchema,
  loginRequestSchema,
  roleNameSchema,
  permissionKeySchema,
  planCreateSchema,
  planListQuerySchema,
  planUpdateSchema,
  serviceAccountCreateSchema,
  serviceAccountListQuerySchema,
  serviceAccountUpdateSchema,
  subscriberCreateSchema,
  subscriberUpdateSchema,
  type EntityListQuery,
  type BillingSummaryQuery,
  type InvoiceGenerate,
  type InvoiceListQuery,
  type PlanCreate,
  type PlanListQuery,
  type PlanUpdate,
  type ServiceAccountCreate,
  type ServiceAccountListQuery,
  type ServiceAccountUpdate,
  type SubscriberCreate,
  type SubscriberUpdate
} from '@bcis/shared'
import { createAuthenticationApi } from './auth-api'
import { createBusinessApi } from './business-api'
import { createAdminApi } from './admin-api'
import icon from '../../resources/icon.png?asset'
import { isApprovedExternalUrl } from './external-url'
import { validateApiEndpoint } from './api-endpoint'

let mainWindow: BrowserWindow | null = null
const defaultApiEndpoint = 'http://127.0.0.1:3000'
let apiEndpoint = defaultApiEndpoint
const notifySessionExpired = (): void => {
  mainWindow?.webContents.send('auth:expired')
}

const authenticationApi = createAuthenticationApi(
  (input, init) => net.fetch(input, init),
  () => apiEndpoint,
  notifySessionExpired
)
const businessApi = createBusinessApi(
  (input, init) => net.fetch(input, init),
  notifySessionExpired,
  () => apiEndpoint
)
const adminApi = createAdminApi(
  (input, init) => net.fetch(input, init),
  () => apiEndpoint,
  notifySessionExpired
)

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== mainWindow.webContents.getURL()
  ) {
    throw new Error('Requests are only available to the BCIS desktop window.')
  }
}

function registerAuthenticationHandlers(): void {
  ipcMain.handle('auth:login', async (event, request: unknown) => {
    assertTrustedRenderer(event)
    const parsed = loginRequestSchema.safeParse(request)
    if (!parsed.success) {
      throw new Error('Enter a valid login identifier and password.')
    }
    return authenticationApi.login(parsed.data)
  })

  ipcMain.handle('auth:current-user', (event) => {
    assertTrustedRenderer(event)
    return authenticationApi.getCurrentUser()
  })

  ipcMain.handle('auth:logout', (event) => {
    assertTrustedRenderer(event)
    return authenticationApi.logout()
  })
}

function registerConfigurationHandlers(): void {
  ipcMain.handle('settings:api-endpoint:get', (event) => {
    assertTrustedRenderer(event)
    return apiEndpoint
  })
  ipcMain.handle('settings:api-endpoint:update', async (event, value: unknown) => {
    assertTrustedRenderer(event)
    const currentUser = await authenticationApi.getCurrentUser()
    if (!currentUser?.permissions.includes('permissions.manage'))
      throw new Error('Administrator permission is required.')
    const candidate = validateApiEndpoint(value)
    const response = await net.fetch(`${candidate}/api/v1/health`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit'
    })
    if (!response.ok)
      throw new Error(
        'The selected API endpoint did not pass its health check; the current endpoint remains unchanged.'
      )
    const health = (await response.json().catch(() => null)) as { status?: unknown } | null
    if (health?.status !== 'healthy')
      throw new Error(
        'The selected API endpoint returned an invalid health response; the current endpoint remains unchanged.'
      )
    const previous = apiEndpoint
    if (candidate !== previous) {
      try {
        await authenticationApi.logout()
      } catch {
        throw new Error(
          'Could not safely close the current session; the configured endpoint remains unchanged.'
        )
      }
    }
    const target = join(app.getPath('userData'), 'settings.json')
    const temporary = `${target}.tmp`
    await writeFile(temporary, JSON.stringify({ apiEndpoint: candidate }), {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporary, target)
    apiEndpoint = candidate
    if (candidate !== previous) mainWindow?.webContents.send('auth:expired')
    return { endpoint: candidate, changed: candidate !== previous }
  })
}

function registerAdminHandlers(): void {
  ipcMain.handle('admin:users:list', (event) => {
    assertTrustedRenderer(event)
    return adminApi.listUsers()
  })
  ipcMain.handle('admin:roles:list', (event) => {
    assertTrustedRenderer(event)
    return adminApi.listRoles()
  })
  ipcMain.handle('admin:users:create', (event, input: unknown) => {
    assertTrustedRenderer(event)
    return adminApi.createUser(input)
  })
  ipcMain.handle('admin:users:update', (event, id: string, input: unknown) => {
    assertTrustedRenderer(event)
    return adminApi.updateUser(id, input)
  })
  ipcMain.handle('admin:roles:update', (event, name: unknown, permissions: unknown) => {
    assertTrustedRenderer(event)
    const parsedName = roleNameSchema.safeParse(name)
    const parsedPermissions = permissionKeySchema.array().safeParse(permissions)
    if (!parsedName.success || !parsedPermissions.success)
      throw new Error('Invalid role permission request.')
    return adminApi.updateRole(parsedName.data, parsedPermissions.data)
  })
}

function registerBusinessHandlers(): void {
  ipcMain.handle('business:plans:list', (event, query: PlanListQuery) => {
    assertTrustedRenderer(event)
    return businessApi.listPlans(planListQuerySchema.parse(query))
  })
  ipcMain.handle('business:plans:get', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.getPlan(id)
  })
  ipcMain.handle('business:plans:create', (event, input: PlanCreate) => {
    assertTrustedRenderer(event)
    return businessApi.createPlan(planCreateSchema.parse(input))
  })
  ipcMain.handle('business:plans:update', (event, id: string, input: PlanUpdate) => {
    assertTrustedRenderer(event)
    return businessApi.updatePlan(id, planUpdateSchema.parse(input))
  })
  ipcMain.handle('business:plans:delete', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.deletePlan(id)
  })

  ipcMain.handle('business:subscribers:list', (event, query: EntityListQuery) => {
    assertTrustedRenderer(event)
    return businessApi.listSubscribers(entityListQuerySchema.parse(query))
  })
  ipcMain.handle('business:subscribers:get', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.getSubscriber(id)
  })
  ipcMain.handle('business:subscribers:create', (event, input: SubscriberCreate) => {
    assertTrustedRenderer(event)
    return businessApi.createSubscriber(subscriberCreateSchema.parse(input))
  })
  ipcMain.handle('business:subscribers:update', (event, id: string, input: SubscriberUpdate) => {
    assertTrustedRenderer(event)
    return businessApi.updateSubscriber(id, subscriberUpdateSchema.parse(input))
  })
  ipcMain.handle('business:subscribers:delete', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.deleteSubscriber(id)
  })

  ipcMain.handle('business:service-accounts:list', (event, query: ServiceAccountListQuery) => {
    assertTrustedRenderer(event)
    return businessApi.listServiceAccounts(serviceAccountListQuerySchema.parse(query))
  })
  ipcMain.handle('business:service-accounts:get', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.getServiceAccount(id)
  })
  ipcMain.handle('business:service-accounts:create', (event, input: ServiceAccountCreate) => {
    assertTrustedRenderer(event)
    return businessApi.createServiceAccount(serviceAccountCreateSchema.parse(input))
  })
  ipcMain.handle(
    'business:service-accounts:update',
    (event, id: string, input: ServiceAccountUpdate) => {
      assertTrustedRenderer(event)
      return businessApi.updateServiceAccount(id, serviceAccountUpdateSchema.parse(input))
    }
  )
  ipcMain.handle('business:service-accounts:delete', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.deleteServiceAccount(id)
  })

  ipcMain.handle('business:invoices:list', (event, query: InvoiceListQuery) => {
    assertTrustedRenderer(event)
    return businessApi.listInvoices(invoiceListQuerySchema.parse(query))
  })
  ipcMain.handle('business:invoices:get', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.getInvoice(id)
  })
  ipcMain.handle('business:invoices:payments:list', (event, id: string) => {
    assertTrustedRenderer(event)
    return businessApi.listInvoicePayments(id)
  })
  ipcMain.handle('business:payments:list', (event, query: unknown) => {
    assertTrustedRenderer(event)
    return businessApi.listPayments(paymentListQuerySchema.parse(query))
  })
  ipcMain.handle('business:invoices:payments:record', (event, id: string, input: unknown) => {
    assertTrustedRenderer(event)
    return businessApi.recordInvoicePayment(id, paymentCreateSchema.parse(input))
  })
  ipcMain.handle('business:invoices:generate', (event, input: InvoiceGenerate) => {
    assertTrustedRenderer(event)
    return businessApi.generateInvoice(invoiceGenerateSchema.parse(input))
  })
  ipcMain.handle('business:billing:summary', (event, query: BillingSummaryQuery) => {
    assertTrustedRenderer(event)
    return businessApi.getBillingSummary(billingSummaryQuerySchema.parse(query))
  })
}

function createWindow(): void {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    if (isApprovedExternalUrl(details.url)) {
      void shell
        .openExternal(details.url)
        .catch((error: unknown) => console.error('Failed to open approved external URL', error))
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  window.webContents.on('will-redirect', (event) => {
    event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  try {
    const content = await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8')
    apiEndpoint = validateApiEndpoint(
      (JSON.parse(content) as { apiEndpoint?: unknown }).apiEndpoint
    )
  } catch {
    apiEndpoint = defaultApiEndpoint
  }
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.bcis.subscriptionbilling')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerAuthenticationHandlers()
  registerConfigurationHandlers()
  registerAdminHandlers()
  registerBusinessHandlers()
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
