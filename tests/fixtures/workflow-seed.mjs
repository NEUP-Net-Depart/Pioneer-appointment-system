import { hashPassword } from '../../src/lib/passwords.js';
export const WORKFLOW_TIME = '2026-10-15T02:00:00Z';
export const STAFF_PASSWORD = 'StaffTest!2026';
// Only for disposable local D1/R2. Real memberships supply reception/repair permissions; attendance and duty are independent.
export function workflowSeed(day) {
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

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function propertyOptions(numRuns = 100) {
  const options = { numRuns: positiveInteger('FC_NUM_RUNS', numRuns), verbose: 2 };
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
    options.path = process.env.FC_PATH;
  }
  return options;
}

export async function checkProperty(build, numRuns = 100) {
  if (!propertiesEnabled) return;
  const fc = (await import('fast-check')).default;
  await fc.assert(build(fc), propertyOptions(numRuns));
}

async function graph(name, initial, edges) {
  const assert = (await import('node:assert/strict')).default;
  const { createMachine, initialTransition, transition } = await import('xstate');
  const { getShortestPaths } = await import('xstate/graph');
  const states = Object.fromEntries(
    [...new Set([initial, ...edges.flatMap((e) => [e.from, e.to])])].map((key) => [key, { on: {} }])
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
  const covered = new Set(),
    visited = new Set();
  const key = (edge) => `${edge.from}/${edge.event}/${edge.to}`;
  const start = () => initialTransition(machine)[0];
  async function execute(snapshot, event, operation) {
    const edge = edges.find((e) => e.from === snapshot.value && e.event === event);
    assert.ok(edge, `${name}: unexpected ${snapshot.value}/${event}`);
    const [next] = transition(machine, snapshot, { type: event });
    assert.equal(next.value, edge.to);
    // Only actual operations whose assertions have completed earn coverage.
    try {
      await operation(edge.to, snapshot.value);
    } catch (error) {
      error.message = `${name} [${snapshot.value} --${event}--> ${edge.to}]: ${error.message}`;
      throw error;
    }
    visited.add(snapshot.value);
    visited.add(next.value);
    covered.add(key(edge));
    return next;
  }
  function complete() {
    assert.deepEqual([...visited].sort(), Object.keys(states).sort(), `${name}: unexecuted states`);
    assert.deepEqual([...covered].sort(), edges.map(key).sort(), `${name}: unexecuted transitions`);
    console.log(
      `[model] ${name}: ${visited.size}/${Object.keys(states).length} states, ${covered.size}/${edges.length} transitions`
    );
  }
  return { start, execute, complete, paths };
}

// Finite graph edges specify independent expected states. Real adapters own
// business assertions and cleanup; revisions and IDs never enlarge the graph.
export async function runModel({ name, initial, edges, setup, observe, random = true }) {
  if (!modelsEnabled) return;
  const g = await graph(name, initial, edges);
  const assert = (await import('node:assert/strict')).default;
  async function execute(model, real, event) {
    const edge = edges.find((e) => e.from === model.snapshot.value && e.event === event);
    model.snapshot = await g.execute(model.snapshot, event, async (to) => {
      await edge.run(real);
      await observe(real, to);
    });
  }
  async function withFixture(body) {
    const real = await setup();
    try {
      await observe(real, initial);
      await body(real);
    } finally {
      await real.dispose();
    }
  }
  for (const edge of edges) {
    const prefix = g.paths.find((path) => path.state.value === edge.from);
    assert.ok(prefix, `${name}: no path to ${edge.from}`);
    const events = [...prefix.steps.slice(1).map((step) => step.event.type), edge.event];
    await withFixture(async (real) => {
      const model = { snapshot: g.start() };
      for (const event of events) await execute(model, real, event);
    });
  }
  g.complete();
  if (!random || !propertiesEnabled) return;
  const fc = (await import('fast-check')).default;
  const commands = [...new Set(edges.map((e) => e.event))].map((event) => ({
    check: (model) => edges.some((e) => e.from === model.snapshot.value && e.event === event),
    run: (model, real) => execute(model, real, event),
    toString: () => event
  }));
  await fc.assert(
    fc.asyncProperty(
      fc.commands(
        commands.map((command) => fc.constant(command)),
        {
          maxCommands: positiveInteger('FC_MAX_COMMANDS', 20)
        }
      ),
      async (sequence) => {
        await withFixture((real) =>
          fc.asyncModelRun(() => ({ model: { snapshot: g.start() }, real }), sequence)
        );
      }
    ),
    propertyOptions(30)
  );
}

// Browser workflows execute their established path once. Each stage includes
// its real action and observable assertions; all declared edges must be visited.
export async function runWorkflow(name, initial, transitions, stages) {
  if (!modelsEnabled) {
    for (const stage of stages) await stage.run();
    return;
  }
  // The graph is declared separately from the executable path. Removing a
  // stage cannot silently remove its state or edge from the coverage target.
  const edges = transitions.map(([from, event, to]) => ({ from, event, to }));
  const g = await graph(name, initial, edges);
  let snapshot = g.start();
  for (const stage of stages) snapshot = await g.execute(snapshot, stage.event, stage.run);
  g.complete();
}

// Capture persistent facts before a rejected write, including receipts/audits.
export async function rejectWithoutWrite(db, operation, expected) {
  const assert = (await import('node:assert/strict')).default;
  const snapshot = () =>
    db.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map(({ name }) => [
        name,
        db.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()
      ]);
  const before = snapshot();
  await assert.rejects(operation, expected);
  assert.deepEqual(snapshot(), before, 'rejected command changed persisted facts');
}
