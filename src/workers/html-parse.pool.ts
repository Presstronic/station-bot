import { Worker } from 'worker_threads';
import { getLogger } from '../utils/logger.js';
import type { ParseRequestBody, ParseResponse } from './html-parse.worker.js';

const logger = getLogger();

type OrgOutcome = 'in_org' | 'not_in_org' | 'undetermined';

type PendingEntry = {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingEntry>();

function rejectAll(err: Error): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    entry.reject(err);
  }
}

function spawnWorker(): Worker {
  const currentUrl = new URL(import.meta.url);
  const isDev = currentUrl.pathname.endsWith('.ts');
  const workerUrl = isDev
    ? new URL('./html-parse.worker.ts', import.meta.url)
    : new URL('./html-parse.worker.js', import.meta.url);

  const w = new Worker(workerUrl, {
    execArgv: isDev ? ['--import', 'tsx'] : [],
  });

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
    // Handle here; the 'exit' handler skips non-zero codes that follow an error.
    logger.error(`html-parse worker error: ${String(err)}`);
    worker = null;
    rejectAll(err);
  });

  w.on('exit', (code) => {
    if (code !== 0 && worker !== null) {
      // Only reached for abnormal exits that were NOT preceded by an 'error' event
      // (which already nulls worker). Avoids double-logging and double-rejecting.
      logger.warn(`html-parse worker exited unexpectedly (code ${code})`);
      worker = null;
      rejectAll(new Error(`html-parse worker exited unexpectedly (code ${code})`));
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
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...request, id });
  });
}

export async function parseOrgOutcomeInWorker(html: string): Promise<OrgOutcome> {
  const value = await sendToWorker({ type: 'orgOutcome', html });
  return value as OrgOutcome;
}

export async function parseCanonicalHandleInWorker(html: string, fallback: string): Promise<string> {
  return sendToWorker({ type: 'canonicalHandle', html, fallback });
}
