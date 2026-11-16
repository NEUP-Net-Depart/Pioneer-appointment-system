import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Each invocation owns a file: Node test processes and Playwright workers never
// read/modify/write a shared report. The parent runner aggregates after exit.
export function modelReport(data) {
  const directory = process.env.MODEL_REPORT_DIR;
  const record = {
    id: randomUUID(),
    source:
      new Error().stack
        .split('\n')
        .find((line) => /\.(?:test|spec)\.mjs:\d+/.test(line))
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
  function finish(error) {
    record.status = error ? 'failed' : 'passed';
    record.finishedAt = new Date().toISOString();
    if (error) record.error = { message: error.message, stack: error.stack };
    save();
  }
  save();
  return { record, save, finish };
}

export function coverage(status = 'pending') {
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

export function visit(record, phase, states, edge) {
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

export async function checkAndReport(fc, property, options, result, save) {
  const details = await fc.check(property, options);
  const sequence = details.counterexample?.[0];
  const commandText =
    sequence?.[Symbol.iterator] && typeof sequence !== 'string' ? String(sequence) : '';
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
    error: details.errorInstance?.message ?? null
  });
  save();
  if (details.failed)
    throw new Error(await fc.asyncDefaultReportMessage(details), { cause: details.errorInstance });
}
