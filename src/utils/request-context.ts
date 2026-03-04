import { AsyncLocalStorage } from 'async_hooks';

type RequestContext = {
  correlationId: string;
};

const requestContextStore = new AsyncLocalStorage<RequestContext>();

export function runWithCorrelationId<T>(correlationId: string, callback: () => Promise<T>): Promise<T> {
  return requestContextStore.run({ correlationId }, callback);
}

export function getCorrelationId(): string | undefined {
  return requestContextStore.getStore()?.correlationId;
}
