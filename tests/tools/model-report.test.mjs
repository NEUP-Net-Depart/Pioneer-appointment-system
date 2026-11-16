import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandOptions, propertyOptions } from '../fixtures/workflow-seed.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = new URL('../fixtures/workflow-seed.mjs', import.meta.url).href;
const controls = ['FC_SEED', 'FC_PATH', 'FC_REPLAY_PATH', 'FC_NUM_RUNS', 'FC_MAX_COMMANDS'];
function environment(values = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const key of controls) delete env[key];
  return { ...env, ...values };
}

test('replay controls reject incomplete or malformed tuples and preserve the empty command log', () => {
  const original = { ...process.env };
  try {
    const valid = { FC_SEED: '-2147483648', FC_PATH: '0:1:0', FC_REPLAY_PATH: ':' };
    const cases = [
      [{ FC_REPLAY_PATH: 'A:B' }, /requires FC_SEED and FC_PATH/],
      [{ FC_SEED: '1', FC_REPLAY_PATH: 'A:B' }, /requires FC_SEED and FC_PATH/],
      [{ FC_PATH: '0' }, /requires FC_SEED/],
      [{ ...valid, FC_SEED: '2147483648' }, /32-bit/],
      [{ ...valid, FC_PATH: '0:-1' }, /FC_PATH must/],
      [{ ...valid, FC_PATH: '' }, /FC_PATH must/],
      [{ ...valid, FC_REPLAY_PATH: '' }, /FC_REPLAY_PATH must/],
      [{ ...valid, FC_REPLAY_PATH: 'A:=' }, /FC_REPLAY_PATH must/],
      [{ ...valid, FC_REPLAY_PATH: 'A:BB' }, /FC_REPLAY_PATH must/],
      [{ ...valid, FC_NUM_RUNS: '0' }, /FC_NUM_RUNS/],
      [{ ...valid, FC_MAX_COMMANDS: '1.5' }, /FC_MAX_COMMANDS/]
    ];
    for (const [values, expected] of cases) {
      for (const key of controls) delete process.env[key];
      Object.assign(process.env, values);
      assert.throws(() => commandOptions(), expected);
    }
    for (const key of controls) delete process.env[key];
    Object.assign(process.env, valid);
    assert.deepEqual(commandOptions(), { maxCommands: 20, replayPath: ':' });
    assert.equal(propertyOptions().path, '0:1:0');
    process.env.FC_REPLAY_PATH = 'AAC:B';
    assert.equal(commandOptions().replayPath, 'AAC:B');
  } finally {
    for (const key of controls) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

async function sandbox(t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'pioneer-model-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'scenario.test.mjs');
  await writeFile(
    file,
    `import test from 'node:test';
import assert from 'node:assert/strict';
import { runModel, runWorkflow } from ${JSON.stringify(fixture)};
${source}`
  );
  return async (mode, values = {}) => {
    let result;
    try {
      result = await execute(
        process.execPath,
        ['scripts/test-models.mjs', mode, '--test-name-pattern=scenario', file],
        { cwd: root, env: environment({ MODEL_REPORT_ROOT: dir, ...values }) }
      );
      result.code = 0;
    } catch (error) {
      result = error;
    }
    const path = result.stdout.match(/\[model-report\] ([^\r\n]+)/)?.[1];
    assert.ok(path, result.stdout + result.stderr);
    return { code: result.code, report: JSON.parse(await readFile(path, 'utf8')) };
  };
}

test('a shrunk command failure reports and replays the same minimal counterexample', async (t) => {
  const run = await sandbox(
    t,
    `test('scenario', async () => {
  await runModel({
    name: 'replay-regression', initial: 'idle',
    edges: [
      { from: 'idle', event: 'ENABLE', to: 'active', run: r => { r.state = 'active'; } },
      { from: 'active', event: 'STEP', to: 'active', run: r => {
        if (++r.steps === 2) throw new Error('injected repeated-step defect');
      } },
      { from: 'active', event: 'DISABLE', to: 'idle', run: r => { r.state = 'idle'; } }
    ],
    setup: async () => ({ state: 'idle', steps: 0, dispose() {} }),
    observe: (r, state) => assert.equal(r.state, state)
  });
});`
  );
  const budget = { FC_SEED: '6', FC_NUM_RUNS: '100', FC_MAX_COMMANDS: '30' };
  const first = await run('properties', budget);
  assert.equal(first.code, 1);
  assert.equal(first.report.status, 'failed');
  const model = first.report.models[0];
  assert.equal(model.deterministic.transitionCoverage, 1);
  assert.equal(model.failedPhase, 'random');
  assert.equal(model.random.status, 'failed');
  assert.ok(model.random.numShrinks > 0);
  assert.ok(model.random.replayPath);
  assert.match(model.random.counterexample, /ENABLE.*STEP.*STEP/);
  const replayed = await run('properties', {
    ...budget,
    FC_SEED: String(model.random.seed),
    FC_PATH: model.random.path,
    FC_REPLAY_PATH: model.random.replayPath
  });
  assert.equal(replayed.code, 1);
  assert.equal(replayed.report.models[0].random.counterexample, model.random.counterexample);
  assert.match(replayed.report.models[0].random.error, /injected repeated-step defect/);
  assert.equal(replayed.report.models[0].random.numShrinks, 0);
});

test('random coverage excludes deterministic paths and concurrent workflow records survive', async (t) => {
  const run = await sandbox(
    t,
    `test('scenario', async () => {
  await runModel({
    name: 'coverage-regression', initial: 'idle',
    edges: [{ from: 'idle', event: 'GO', to: 'done', run: r => { r.state = 'done'; } }],
    setup: async () => ({ state: 'idle', dispose() {} }),
    observe: (r, state) => assert.equal(r.state, state)
  });
  await Promise.all([1, 2].map(() => runWorkflow('same-name', 'idle',
    [['idle', 'GO', 'done']], [{ event: 'GO', run: async () => {} }])));
});`
  );
  // This seed generates an empty command sequence. The initial state is still observed.
  const { code, report } = await run('properties', { FC_SEED: '10', FC_NUM_RUNS: '1' });
  assert.equal(code, 0);
  assert.equal(report.models.length, 3);
  assert.equal(new Set(report.models.map((model) => model.id)).size, 3);
  const model = report.models.find((model) => model.name === 'coverage-regression');
  assert.equal(model.deterministic.transitionCoverage, 1);
  assert.equal(model.random.runs, 1);
  assert.deepEqual(model.random.visitedStates, ['idle']);
  assert.deepEqual(model.random.visitedTransitions, []);
  assert.equal(model.random.stateCoverage, 0.5);
  assert.equal(model.random.transitionCoverage, 0);
  for (const workflow of report.models.filter((model) => model.name === 'same-name')) {
    assert.equal(workflow.deterministic.transitionCoverage, 1);
    assert.equal(workflow.random.status, 'not-supported');
  }
});
