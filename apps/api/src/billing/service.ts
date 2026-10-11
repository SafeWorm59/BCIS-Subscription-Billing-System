import type {
  BillingSummary,
  BillingSummaryQuery,
  Invoice,
  InvoiceGenerate,
  InvoiceListItem,
  InvoiceListQuery,
  Payment,
  PaymentCreate,
  PaymentListItem,
  PaymentListQuery
} from '@bcis/shared'
import { BusinessError } from '../business/errors.js'
import type { BillingRepository } from './repository.js'

export interface BillingServices {
  generate(input: InvoiceGenerate): Promise<Invoice>
  list(
    query: InvoiceListQuery
  ): Promise<{ items: InvoiceListItem[]; total: number }>
  get(id: string): Promise<Invoice>
  summary(query: BillingSummaryQuery): Promise<BillingSummary>
  listPayments(invoiceId: string): Promise<Payment[]>
  listPaymentsPage(
    query: PaymentListQuery
  ): Promise<{ items: PaymentListItem[]; total: number }>
  recordPayment(invoiceId: string, input: PaymentCreate): Promise<Payment>
}

export function createBillingServices(
  repository: BillingRepository
): BillingServices {
  return {
    generate: (input) => repository.generate(input),
    list: (query) => repository.list(query),
    async get(id) {
      const invoice = await repository.get(id)
      if (!invoice) throw new BusinessError('Invoice not found', 404)
      return invoice
    },
    summary: (query) => repository.summary(query),
    listPayments: (id) => repository.listPayments(id),
    listPaymentsPage: (query) => repository.listPaymentsPage(query),
    recordPayment: (id, input) => repository.recordPayment(id, input)
  }
}
