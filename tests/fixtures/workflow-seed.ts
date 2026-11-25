import assert from 'node:assert/strict';
import type { IRawProperty } from 'fast-check';
import type { DatabaseSync } from 'node:sqlite';
import type { ModelPhase } from '../helpers/model-report.ts';

type FastCheck = typeof import('fast-check').default;
type PropertyOptions = { numRuns: number; verbose: 2; seed?: number; path?: string };
type Edge = { from: string; event: string; to: string };
export type ModelEdge<F> = Edge & { run(real: F): unknown };

export function modelEdges<F>(edges: [from: string, to: string, event: string, run: (real: F) => unknown][]): ModelEdge<F>[] {
  return edges.map(([from, to, event, run]) => ({ from, to, event, run }));
}

interface ModelTest<F extends { dispose(): unknown }> {
  name: string;
  initial: string;
  edges: ModelEdge<F>[];
  setup(): F | Promise<F>;
  observe(real: F, state: string): unknown;
  random?: boolean;
}
import { hashPassword } from '../../src/lib/passwords.ts';
import { modelReport, coverage, visit, checkAndReport } from '../helpers/model-report.ts';
export const WORKFLOW_TIME = '2026-10-15T02:00:00Z';
export const STAFF_PASSWORD = 'StaffTest!2026';
// Only for disposable local D1/R2. Real memberships supply reception/repair permissions; attendance and duty are independent.
export function workflowSeed(day: string) {
  const password = hashPassword(STAFF_PASSWORD);
  return [
    ...[
      ['20261001', '林悦', '南湖', 'dept-office', 'head'],
      ['20261002', '陈宇', '南湖', 'dept-network', 'member'],
      ['20261003', '周宁', '南湖', 'dept-hardware', 'member'],
      ['20261004', '许晨', '浑南', 'dept-art', 'member']
    ].map(
      ([account, name, campus, department, position]) => `
 INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('${account}','${name}','technician','${campus}','${password}','2026-01-01');
 INSERT INTO staff_campus_grants VALUES('${account}','${campus}');
 INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('post-${account}','member-${account}','${department}','${position}','primary',1,'2026-01-01','2026-01-01');`
    ),
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES('affairs-20261001','member-20261001','dept-office','maintenance_affairs',0,'2026-01-01','2026-01-01');",
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES('affairs-20261002','member-20261002','dept-network','maintenance_affairs',0,'2026-01-01','2026-01-01'),('exchange-20261002','member-20261002','dept-hardware','exchange',0,'2026-01-01','2026-01-01');",
    ...['南湖', '浑南'].map(
      (campus) =>
        `INSERT INTO service_locations(campus,date,location,updated_at) VALUES('${campus}','${day}','${campus}测试维修室','${day}');`
    )
  ].join('\n');
}

// Optional test drivers live with the existing workflow fixture. They never
// register tests, and neither library is loaded by the default test/CI path.
export const modelsEnabled = process.env.TEST_MODELS === '1';
export const propertiesEnabled = process.env.TEST_PROPERTIES === '1';

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function propertyOptions(numRuns = 100) {
  const options: PropertyOptions = { numRuns: positiveInteger('FC_NUM_RUNS', numRuns), verbose: 2 };
  if (process.env.FC_SEED !== undefined) {
    const seed = Number(process.env.FC_SEED);
    if (
      !/^-?\d+$/.test(process.env.FC_SEED) ||
      !Number.isInteger(seed) ||
      seed < -2147483648 ||
      seed > 2147483647
    )
      throw new Error('FC_SEED must be a signed 32-bit integer');
    options.seed = seed;
  }
  if (process.env.FC_PATH !== undefined) {
    if (options.seed === undefined)
      throw new Error('FC_PATH requires FC_SEED and a single selected property');
    if (
      !/^\d+(?::\d+)*$/.test(process.env.FC_PATH) ||
      process.env.FC_PATH.split(':').some((part) => !Number.isSafeInteger(Number(part)))
    )
      throw new Error('FC_PATH must contain colon-separated non-negative safe integers');
    options.path = process.env.FC_PATH;
  }
  if (process.env.FC_REPLAY_PATH !== undefined) {
    if (options.path === undefined)
      throw new Error('FC_REPLAY_PATH requires FC_SEED and FC_PATH for a single command property');
    const parts = process.env.FC_REPLAY_PATH.match(/^([A-Za-z0-9+/]*):([A-Za-z0-9+/]*)$/);
    // fast-check 4 encodes run lengths in base64 characters and six boolean
    // flags per character. ':' is the valid empty replay log; '=' is not padding.
    if (!parts || parts[2].length !== Math.ceil(parts[1].length / 6))
      throw new Error(
        'FC_REPLAY_PATH must be the replayPath value from fast-check (without quotes)'
      );
  }
  return options;
}

export function commandOptions() {
  propertyOptions(); // Validate the seed/path/replayPath tuple before generating commands.
  return {
    maxCommands: positiveInteger('FC_MAX_COMMANDS', 20),
    ...(process.env.FC_REPLAY_PATH !== undefined ? { replayPath: process.env.FC_REPLAY_PATH } : {})
  };
}

export async function checkProperty<Ts extends readonly unknown[]>(build: (fc: FastCheck) => IRawProperty<Ts>, numRuns = 100) {
  if (!propertiesEnabled) return;
  const fc = (await import('fast-check')).default;
  const options = propertyOptions(numRuns);
  if (process.env.FC_REPLAY_PATH !== undefined)
    throw new Error('FC_REPLAY_PATH only applies to a command model, not a data property');
  const report = modelReport({ kind: 'property', requestedRuns: options.numRuns });
  try {
    await checkAndReport(fc, build(fc), options, report.record, report.save);
    report.finish();
  } catch (error) {
    report.finish(error);
    throw error;
  }
}

async function graph(name: string, initial: string, edges: Edge[], report: ReturnType<typeof graphReport>) {
  const { createMachine, initialTransition, transition } = await import('xstate');
  const { getShortestPaths } = await import('xstate/graph');
  const states = Object.fromEntries(
    [...new Set([initial, ...edges.flatMap((e) => [e.from, e.to])])].map((key) => [key, { on: {} as Record<string, { target: string }> }])
  );
  for (const edge of edges) {
    assert.equal(
      states[edge.from].on[edge.event],
      undefined,
      `${name}: duplicate ${edge.from}/${edge.event}`
    );
    states[edge.from].on[edge.event] = { target: edge.to };
  }
  const machine = createMachine({ id: name, initial, states });
  const paths = getShortestPaths(machine, { limit: 10000 });
  assert.equal(paths.length, Object.keys(states).length, `${name}: unreachable declared state`);
  const key = (edge: Edge) => `${edge.from}/${edge.event}/${edge.to}`;
  const start = () => initialTransition(machine)[0];
  async function execute(snapshot: ReturnType<typeof start>, event: string, operation: (next: string, previous: string) => unknown, phase: ModelPhase = 'deterministic') {
    const edge = edges.find((e) => e.from === snapshot.value && e.event === event);
    assert.ok(edge, `${name}: unexpected ${snapshot.value}/${event}`);
    const [next] = transition(machine, snapshot, { type: event });
    assert.equal(next.value, edge.to);
    // Only actual operations whose assertions have completed earn coverage.
    try {
      await operation(edge.to, edge.from);
    } catch (error) {
      if (error instanceof Error) error.message = `${name} [${snapshot.value} --${event}--> ${edge.to}]: ${error.message}`;
      throw error;
    }
    visit(report.record, phase, [edge.from, edge.to], key(edge));
    return next;
  }
  function complete() {
    const { visitedStates, visitedTransitions } = report.record.deterministic;
    assert.deepEqual(
      [...visitedStates].sort(),
      Object.keys(states).sort(),
      `${name}: unexecuted states`
    );
    assert.deepEqual(
      [...visitedTransitions].sort(),
      edges.map(key).sort(),
      `${name}: unexecuted transitions`
    );
    report.record.deterministic.status = 'passed';
    report.save();
    console.log(
      `[model] ${name} deterministic: ${visitedStates.length}/${Object.keys(states).length} states, ${visitedTransitions.length}/${edges.length} transitions`
    );
  }
  return { start, execute, complete, paths };
}

function graphReport(name: string, initial: string, edges: Edge[], kind: string, randomStatus?: string) {
  const states = [...new Set([initial, ...edges.flatMap((e) => [e.from, e.to])])];
  return modelReport({
    kind,
    name,
    initial,
    states,
    transitions: edges.map(({ from, event, to }) => ({
      id: `${from}/${event}/${to}`,
      from,
      event,
      to
    })),
    stateCount: states.length,
    transitionCount: edges.length,
    deterministic: coverage('running'),
    random: coverage(randomStatus)
  });
}

// Finite graph edges specify independent expected states. Real adapters own
// business assertions and cleanup; revisions and IDs never enlarge the graph.
export async function runModel<F extends { dispose(): unknown }>({ name, initial, edges, setup, observe, random = true }: ModelTest<F>) {
  if (!modelsEnabled) return;
  const report = graphReport(
    name,
    initial,
    edges,
    'service',
    !random ? 'not-supported' : propertiesEnabled ? 'pending' : 'not-requested'
  );
  let phase: ModelPhase = 'deterministic';
  try {
    const options = random && propertiesEnabled ? propertyOptions(30) : null;
    const constraints = options ? commandOptions() : null;
    const g = await graph(name, initial, edges, report);
      type Model = { snapshot: ReturnType<typeof g.start> };
    async function execute(model: Model, real: F, event: string) {
      const edge = edges.find((e) => e.from === model.snapshot.value && e.event === event);
      assert.ok(edge, `Missing model edge ${event}`);
      model.snapshot = await g.execute(
        model.snapshot,
        event,
        async (to) => {
          await edge.run(real);
          await observe(real, to);
        },
        phase
      );
    }
    async function withFixture(body: (real: F) => unknown) {
      const real = await setup();
      try {
        await observe(real, initial);
        visit(report.record, phase, [initial]);
        await body(real);
      } finally {
        await real.dispose();
      }
    }
    for (const edge of edges) {
      const prefix = g.paths.find((path) => path.state.value === edge.from);
      assert.ok(prefix, `${name}: no path to ${edge.from}`);
      const events = [...prefix.steps.slice(1).map((step) => step.event.type), edge.event];
      report.record.deterministic.runs++;
      await withFixture(async (real) => {
        const model = { snapshot: g.start() };
        for (const event of events) await execute(model, real, event);
      });
      report.save();
    }
    g.complete();
    if (options && constraints) {
      phase = 'random';
      Object.assign(report.record.random, {
        status: 'running',
        attempts: 0,
        requestedRuns: options.numRuns,
        maxCommands: constraints.maxCommands,
        replay: {
          seed: options.seed ?? null,
          path: options.path ?? null,
          replayPath: constraints.replayPath ?? null
        }
      });
      const fc = (await import('fast-check')).default;
      const commands = [...new Set(edges.map((e) => e.event))].map((event) => ({
        check: (model: Readonly<Model>) => edges.some((e) => e.from === model.snapshot.value && e.event === event),
        run: (model: Model, real: F) => execute(model, real, event),
        toString: () => event
      }));
      await checkAndReport(
        fc,
        fc.asyncProperty(
          fc.commands(
            commands.map((command) => fc.constant(command)),
            constraints
          ),
          async (sequence) => {
            report.record.random.attempts = (report.record.random.attempts ?? 0) + 1;
            try {
              await withFixture((real) =>
                fc.asyncModelRun(() => ({ model: { snapshot: g.start() }, real }), sequence)
              );
            } finally {
              report.save();
            }
          }
        ),
        options,
        report.record.random,
        report.save
      );
      const explored = report.record.random;
      console.log(
        `[model] ${name} random: ${explored.visitedStates.length}/${report.record.stateCount} states, ${explored.visitedTransitions.length}/${edges.length} transitions (${explored.runs} runs, seed ${explored.seed})`
      );
    }
    report.finish();
  } catch (error) {
    report.record[phase].status = 'failed';
    report.record.failedPhase = phase;
    report.finish(error);
    throw error;
  }
}

// Browser workflows execute their established path once. Each stage includes
// its real action and observable assertions; all declared edges must be visited.
export async function runWorkflow(name: string, initial: string, transitions: [string, string, string][], stages: { event: string; run(): unknown }[]) {
  if (!modelsEnabled) {
    for (const stage of stages) await stage.run();
    return;
  }
  // The graph is declared separately from the executable path. Removing a
  // stage cannot silently remove its state or edge from the coverage target.
  const edges = transitions.map(([from, event, to]) => ({ from, event, to }));
  const report = graphReport(name, initial, edges, 'workflow', 'not-supported');
  try {
    const g = await graph(name, initial, edges, report);
    let snapshot = g.start();
    report.record.deterministic.runs++;
    for (const stage of stages) {
      snapshot = await g.execute(snapshot, stage.event, stage.run);
      report.save();
    }
    g.complete();
    report.finish();
  } catch (error) {
    report.record.deterministic.status = 'failed';
    report.record.failedPhase = 'deterministic';
    report.finish(error);
    throw error;
  }
}

// Capture persistent facts before a rejected write, including receipts/audits.
export async function rejectWithoutWrite(db: { sqlite: DatabaseSync }, operation: () => Promise<unknown>, expected: Parameters<typeof assert.rejects>[1]) {
  const snapshot = () =>
    db.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map(({ name }) => [
        name,
        db.sqlite.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`).all()
      ]);
  const before = snapshot();
  await assert.rejects(operation, expected);
  assert.deepEqual(snapshot(), before, 'rejected command changed persisted facts');
}
