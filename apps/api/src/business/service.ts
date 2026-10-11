import type {
  EntityListQuery,
  Plan,
  PlanCreate,
  PlanListQuery,
  PlanUpdate,
  ServiceAccount,
  ServiceAccountCreate,
  ServiceAccountListQuery,
  ServiceAccountUpdate,
  Subscriber,
  SubscriberCreate,
  SubscriberUpdate
} from '@bcis/shared'
import { BusinessError } from './errors.js'
import { assertRecordFound, type BusinessRepository } from './repository.js'

export interface BusinessServices {
  plans: {
    list(query: PlanListQuery): Promise<{ items: Plan[]; total: number }>
    get(id: string): Promise<Plan>
    create(input: PlanCreate): Promise<Plan>
    update(id: string, input: PlanUpdate): Promise<Plan>
    delete(id: string): Promise<void>
  }
  subscribers: {
    list(
      query: EntityListQuery
    ): Promise<{ items: Subscriber[]; total: number }>
    get(id: string): Promise<Subscriber>
    create(input: SubscriberCreate): Promise<Subscriber>
    update(id: string, input: SubscriberUpdate): Promise<Subscriber>
    delete(id: string): Promise<void>
  }
  serviceAccounts: {
    list(
      query: ServiceAccountListQuery
    ): Promise<{ items: ServiceAccount[]; total: number }>
    get(id: string): Promise<ServiceAccount>
    create(input: ServiceAccountCreate): Promise<ServiceAccount>
    update(id: string, input: ServiceAccountUpdate): Promise<ServiceAccount>
    delete(id: string): Promise<void>
  }
}

export function createBusinessServices(
  repository: BusinessRepository
): BusinessServices {
  return {
    plans: {
      list: (query) => repository.listPlans(query),
      async get(id) {
        return assertRecordFound(await repository.getPlan(id), 'Plan')
      },
      create: (input) => repository.createPlan(input),
      async update(id, input) {
        return assertRecordFound(await repository.updatePlan(id, input), 'Plan')
      },
      async delete(id) {
        if (!(await repository.deletePlan(id)))
          throw new BusinessError('Plan not found', 404)
      }
    },
    subscribers: {
      list: (query) => repository.listSubscribers(query),
      async get(id) {
        return assertRecordFound(
          await repository.getSubscriber(id),
          'Subscriber'
        )
      },
      create: (input) => repository.createSubscriber(input),
      async update(id, input) {
        return assertRecordFound(
          await repository.updateSubscriber(id, input),
          'Subscriber'
        )
      },
      async delete(id) {
        if (!(await repository.deleteSubscriber(id)))
          throw new BusinessError('Subscriber not found', 404)
      }
    },
    serviceAccounts: {
      list: (query) => repository.listServiceAccounts(query),
      async get(id) {
        return assertRecordFound(
          await repository.getServiceAccount(id),
          'Service account'
        )
      },
      async create(input) {
        if (!(await repository.getSubscriber(input.subscriberId))) {
          throw new BusinessError('Subscriber not found', 404)
        }
        if (!(await repository.getPlan(input.planId))) {
          throw new BusinessError('Plan not found', 404)
        }
        return repository.createServiceAccount(input)
      },
      async update(id, input) {
        if (!(await repository.getServiceAccount(id))) {
          throw new BusinessError('Service account not found', 404)
        }
        if (
          input.subscriberId &&
          !(await repository.getSubscriber(input.subscriberId))
        ) {
          throw new BusinessError('Subscriber not found', 404)
        }
        if (input.planId && !(await repository.getPlan(input.planId))) {
          throw new BusinessError('Plan not found', 404)
        }
        return assertRecordFound(
          await repository.updateServiceAccount(id, input),
          'Service account'
        )
      },
      async delete(id) {
        if (!(await repository.deleteServiceAccount(id)))
          throw new BusinessError('Service account not found', 404)
      }
    }
  }
}
