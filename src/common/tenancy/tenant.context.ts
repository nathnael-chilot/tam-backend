import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId?: string;
  userId?: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export class TenantContext {
  static getTenantId(): string | undefined {
    return tenantStorage.getStore()?.tenantId;
  }

  static getUserId(): string | undefined {
    return tenantStorage.getStore()?.userId;
  }

  static run<R>(store: TenantStore, callback: () => R): R {
    return tenantStorage.run(store, callback);
  }
}
