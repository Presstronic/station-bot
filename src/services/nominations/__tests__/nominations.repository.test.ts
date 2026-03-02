import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getUnprocessedNominations,
  markAllNominationsProcessed,
  markNominationProcessedByHandle,
  recordNomination,
} from '../nominations.repository.ts';

const originalStorePath = process.env.NOMINATIONS_STORE_PATH;
let tempDir = '';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'station-bot-nominations-'));
  process.env.NOMINATIONS_STORE_PATH = join(tempDir, 'nominations.json');
});

afterEach(() => {
  if (originalStorePath === undefined) {
    delete process.env.NOMINATIONS_STORE_PATH;
  } else {
    process.env.NOMINATIONS_STORE_PATH = originalStorePath;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('nominations repository', () => {
  it('aggregates nomination count and keeps events', () => {
    recordNomination('TestPilot', '1', 'user#1', 'helpful');
    const second = recordNomination('testpilot', '2', 'user#2', null);

    expect(second.nominationCount).toBe(2);
    expect(second.events).toHaveLength(2);
    expect(getUnprocessedNominations()).toHaveLength(1);
  });

  it('processes a single nomination by handle', () => {
    recordNomination('PilotA', '1', 'user#1', null);

    expect(markNominationProcessedByHandle('pilota', 'admin-1')).toBe(true);
    expect(getUnprocessedNominations()).toHaveLength(0);
  });

  it('processes all unprocessed nominations', () => {
    recordNomination('PilotA', '1', 'user#1', null);
    recordNomination('PilotB', '2', 'user#2', null);

    expect(markAllNominationsProcessed('admin-1')).toBe(2);
    expect(getUnprocessedNominations()).toHaveLength(0);
  });
});
