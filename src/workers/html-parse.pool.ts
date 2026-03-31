import { Worker } from 'worker_threads';
import { getLogger } from '../utils/logger.js';
import type { OrgOutcome, ParseRequestBody, ParseResponse } from './html-parse.worker.js';

const logger = getLogger();

type PendingEntry = {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  worker: Worker;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingEntry>();

function rejectByWorker(w: Worker, err: Error): boolean {
  let found = false;
  for (const [id, entry] of pending) {
    if (entry.worker === w) {
      pending.delete(id);
      entry.reject(err);
      found = true;
    }
  }
  return found;
}

function spawnWorker(): Worker {
  const currentUrl = new URL(import.meta.url);
  const isDev = currentUrl.pathname.endsWith('.ts');
  const workerUrl = isDev
    ? new URL('./html-parse.worker.ts', import.meta.url)
    : new URL('./html-parse.worker.js', import.meta.url);

  // In dev, append '--import tsx' to the parent's execArgv (deduped) so the
  // worker can load TypeScript source files. In prod, omit execArgv entirely
  // so the worker inherits the parent process flags unchanged.
  let workerOptions: ConstructorParameters<typeof Worker>[1] = {};
  if (isDev) {
    const base = process.execArgv ?? [];
    const hasTsx = base.some(
      (arg, i) => arg === '--import=tsx' || (arg === '--import' && base[i + 1] === 'tsx')
    );
    workerOptions = { execArgv: hasTsx ? base : [...base, '--import', 'tsx'] };
  }

  const w = new Worker(workerUrl, workerOptions);

  w.on('message', (response: ParseResponse) => {
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) {
      entry.resolve(response.value);
    } else {
      entry.reject(new Error(response.error));
    }
  });

  w.on('error', (err) => {
    // Node fires 'error' then 'exit' for uncaught worker exceptions.
    // Reject only this worker's pending items here; 'exit' will fire next but
    // by then those entries are already gone, so it becomes a no-op.
    logger.error(`html-parse worker error: ${String(err)}`);
    worker = null;
    rejectByWorker(w, err);
  });

  w.on('exit', (code) => {
    // Always drop the reference to this specific worker instance if it is still
    // the current one (the error handler may have already replaced it with null).
    if (worker === w) {
      worker = null;
    }

    // Reject only in-flight requests that were sent to *this* worker — a new
    // worker may have already been spawned and have its own pending items in the
    // map; those must not be rejected here.
    const message = code !== 0
      ? `html-parse worker exited unexpectedly (code ${code})`
      : 'html-parse worker exited while requests were pending';
    const hadOwned = rejectByWorker(w, new Error(message));
    if (hadOwned && code !== 0) {
      logger.warn(message);
    }
  });

  return w;
}

function getWorker(): Worker {
  if (!worker) {
    worker = spawnWorker();
  }
  return worker;
}

function sendToWorker(request: ParseRequestBody): Promise<string> {
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    try {
      const w = getWorker();
      pending.set(id, { resolve, reject, worker: w });
      w.postMessage({ ...request, id });
    } catch (err) {
      pending.delete(id);
      const error = err instanceof Error ? err : new Error(String(err));
      reject(new Error(`Failed to send message to html-parse worker: ${error.message}`));
    }
  });
}

const ORG_OUTCOMES: ReadonlySet<string> = new Set<OrgOutcome>(['in_org', 'not_in_org', 'undetermined']);

function assertOrgOutcome(value: string): OrgOutcome {
  if (!ORG_OUTCOMES.has(value)) {
    throw new Error(`html-parse worker returned unexpected org outcome: "${value}"`);
  }
  return value as OrgOutcome;
}

export async function parseOrgOutcomeInWorker(html: string): Promise<OrgOutcome> {
  const value = await sendToWorker({ type: 'orgOutcome', html });
  return assertOrgOutcome(value);
}

export async function parseCanonicalHandleInWorker(html: string, fallback: string): Promise<string> {
  return sendToWorker({ type: 'canonicalHandle', html, fallback });
}

function assertSelectorCheckValue(value: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw new Error(`html-parse worker returned unexpected selector-check value: "${value}"`);
  }
  return value === 'true';
}

export async function parseSelectorCheckInWorker(
  html: string,
  parentSelector: string,
  childSelector: string,
  searchValue: string
): Promise<boolean> {
  const value = await sendToWorker({ type: 'selectorCheck', html, parentSelector, childSelector, searchValue });
  return assertSelectorCheckValue(value);
}
