import type { IRawProperty, Parameters as PropertyParameters } from 'fast-check';

export type ModelPhase = 'deterministic' | 'random';
type FastCheck = typeof import('fast-check').default;
type ReportMetadata = {
  id: string;
  source: string | null;
  project: string | null;
  startedAt: string;
  finishedAt?: string;
  status: string;
  error?: { message: string; stack?: string };
  failedPhase?: ModelPhase;
};
interface PhaseCoverage {
  status: string;
  runs: number;
  steps: number;
  visitedStates: string[];
  visitedTransitions: string[];
  stateCoverage: number;
  transitionCoverage: number;
  attempts?: number;
  seed?: number;
}
type GraphCoverage = Record<ModelPhase, PhaseCoverage> & { stateCount: number; transitionCount: number };
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Each invocation owns a file: Node test processes and Playwright workers never
// read/modify/write a shared report. The parent runner aggregates after exit.
export function modelReport<T extends { kind: string }>(data: T) {
  const directory = process.env.MODEL_REPORT_DIR;
  const record: ReportMetadata & T = {
    id: randomUUID(),
    source:
      new Error().stack
        ?.split('\n')
        .find((line) => /\.(?:test|spec)\.ts:\d+/.test(line))
        ?.trim() ?? null,
    project: process.env.MODEL_REPORT_PROJECT ?? null,
    startedAt: new Date().toISOString(),
    status: 'running',
    ...data
  };
  function save() {
    if (!directory) return;
    const entries = join(directory, 'entries');
    mkdirSync(entries, { recursive: true });
    const file = join(entries, `${record.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
    renameSync(`${file}.tmp`, file);
  }
  function finish(error?: unknown) {
    record.status = error ? 'failed' : 'passed';
    record.finishedAt = new Date().toISOString();
    if (error) record.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    save();
  }
  save();
  return { record, save, finish };
}

export function coverage(status = 'pending'): PhaseCoverage {
  return {
    status,
    runs: 0,
    steps: 0,
    visitedStates: [],
    visitedTransitions: [],
    stateCoverage: 0,
    transitionCoverage: 0
  };
}

export function visit(record: GraphCoverage, phase: ModelPhase, states: string[], edge?: string) {
  const value = record[phase];
  for (const state of states)
    if (!value.visitedStates.includes(state)) value.visitedStates.push(state);
  if (edge !== undefined) {
    if (!value.visitedTransitions.includes(edge)) value.visitedTransitions.push(edge);
    value.steps++;
  }
  value.stateCoverage = value.visitedStates.length / record.stateCount;
  value.transitionCoverage = record.transitionCount
    ? value.visitedTransitions.length / record.transitionCount
    : 1;
}

export async function checkAndReport<Ts extends readonly unknown[]>(fc: FastCheck, property: IRawProperty<Ts>, options: PropertyParameters<Ts>, result: object, save: () => void) {
  const details = await fc.check(property, options);
  const sequence = details.counterexample?.[0];
  const commandText =
    sequence != null && typeof sequence !== 'string' && Reflect.get(Object(sequence), Symbol.iterator) ? String(sequence) : '';
  const replay = commandText.match(/replayPath="([A-Za-z0-9+/]*:[A-Za-z0-9+/]*)"/);
  Object.assign(result, {
    status: details.failed ? 'failed' : 'passed',
    runs: details.numRuns,
    numSkips: details.numSkips,
    numShrinks: details.numShrinks,
    interrupted: details.interrupted,
    seed: details.seed,
    path: details.counterexamplePath,
    replayPath: replay?.[1] ?? null,
    counterexample: details.counterexample === null ? null : fc.stringify(details.counterexample),
    error: details.errorInstance instanceof Error ? details.errorInstance.message : null
  });
  save();
  if (details.failed)
    throw new Error(await fc.asyncDefaultReportMessage(details), { cause: details.errorInstance });
}
