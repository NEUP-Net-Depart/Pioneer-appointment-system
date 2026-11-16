import { runModel } from './fixtures/workflow-seed.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';

const { code } = await transform(
  await readFile(new URL('../frontend/staff-react/field/intake-upload.ts', import.meta.url), 'utf8'),
  { loader: 'ts', format: 'cjs' }
);
const flush = () => new Promise(resolve => setImmediate(resolve));

function uploadJob({ apiJson, uploadAttachments, onSaved = () => {} }) {
  const module = { exports: {} };
  const imports = {
    '../../../shared/api.js': { apiJson },
    '../../../shared/attachments.js': { uploadAttachments },
    './photos': { intakePhoto: async file => file }
  };
  runInNewContext(code, {
    module,
    require: name => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
    sessionStorage: { getItem: () => 'test-session' },
    crypto,
    setTimeout,
    clearTimeout
  });
  return module.exports.intakeUpload('test-order', onSaved);
}

test('confirming a deferred receipt keeps photo controls idle when no upload is ready', async () => {
  let reads = 0;
  const receipt = { receivedAt: '2026-10-15T02:00:00Z', canSupplement: true };
  const job = uploadJob({ apiJson: async () => { reads++; return receipt; } });
  job.confirmed(receipt);
  assert.equal(job.snapshot().linking, false);
  await flush();
  assert.equal(reads, 0);
});

test('a refreshed partial receipt keeps retry enabled and reuses the successful upload', async () => {
  await uploadModel();
  let releaseFront;
  const front = new Promise(resolve => { releaseFront = resolve; });
  let saved = { receivedAt: '2026-10-15T02:00:00Z', revision: 1, canSupplement: true };
  const uploads = [], requests = [], linking = [];
  const job = uploadJob({
    apiJson: async (path, options = {}) => {
      requests.push([options.method || 'GET', path]);
      if (options.method === 'POST') {
        assert.equal(options.json.revision, saved.revision);
        saved = { ...saved, ...options.json, revision: saved.revision + 1 };
        saved.canSupplement = !saved.frontPhotoId || !saved.backPhotoId;
      }
      return { ...saved };
    },
    uploadAttachments: async (_order, _files, purpose) => {
      uploads.push(purpose);
      if (purpose === 'intake_front') await front;
      else if (uploads.filter(value => value === purpose).length === 1)
        throw new Error('Upload rate limited');
      return [{ id: purpose }];
    }
  });
  job.subscribe(() => linking.push(job.snapshot().linking));
  job.select('front', new File(['front'], 'front.png'));
  job.select('back', new File(['back'], 'back.png'));
  const pending = job.upload();
  await flush();
  assert.equal(job.snapshot().canSkip, true);
  job.confirmed(saved);
  await flush();
  releaseFront();
  await pending;
  await flush();
  assert.equal(saved.frontPhotoId, 'intake_front', job.snapshot().error);
  assert.equal(saved.backPhotoId, undefined);
  assert.equal(job.snapshot().linking, false);

  // The query refresh arrives after automatic association has finished. It
  // must not disable the retry button again between pointer down and click.
  linking.length = 0;
  const requestCount = requests.length;
  job.confirmed({ ...saved });
  assert.equal(job.snapshot().linking, false);
  await flush();
  assert.ok(linking.every(value => !value));
  assert.equal(requests.length, requestCount);

  await job.supplement();
  assert.equal(saved.frontPhotoId, 'intake_front');
  assert.equal(saved.backPhotoId, 'intake_back');
  assert.equal(saved.canSupplement, false);
  assert.deepEqual(uploads, ['intake_front', 'intake_back', 'intake_back']);
});

async function uploadModel() {
  const select = (r) => {
    for (const side of ['front', 'back']) r.job.select(side, new File([side], side + '.png'));
  };
  const edges = [
    ['idle', 'confirmed', 'CONFIRM_EMPTY', (r) => r.job.confirmed(r.saved)],
    ['confirmed', 'selected', 'SELECT', select],
    [
      'selected',
      'partial',
      'UPLOAD_PARTIAL',
      async (r) => {
        await r.job.upload();
        await flush();
      }
    ],
    [
      'partial',
      'partial',
      'REFRESH_PARTIAL',
      async (r) => {
        const before = r.requests;
        r.job.confirmed({ ...r.saved });
        await flush();
        assert.equal(r.requests, before);
      }
    ],
    [
      'partial',
      'complete',
      'RETRY',
      async (r) => {
        await r.job.supplement();
        await flush();
      }
    ],
    [
      'complete',
      'complete',
      'REFRESH_COMPLETE',
      async (r) => {
        const before = r.requests;
        r.job.confirmed({ ...r.saved });
        await flush();
        assert.equal(r.requests, before);
      }
    ]
  ].map(([from, to, event, run]) => ({ from, to, event, run }));
  await runModel({
    name: 'intake-upload',
    initial: 'idle',
    edges,
    setup: async () => {
      const r = {
        requests: 0,
        uploads: [],
        saved: { receivedAt: '2026-10-15T02:00:00Z', revision: 1, canSupplement: true },
        dispose() {}
      };
      r.job = uploadJob({
        apiJson: async (_path, options = {}) => {
          r.requests++;
          if (options.method === 'POST') {
            assert.equal(options.json.revision, r.saved.revision);
            r.saved = { ...r.saved, ...options.json, revision: r.saved.revision + 1 };
            r.saved.canSupplement = !r.saved.frontPhotoId || !r.saved.backPhotoId;
          }
          return { ...r.saved };
        },
        uploadAttachments: async (_order, _files, purpose) => {
          r.uploads.push(purpose);
          if (purpose === 'intake_back' && r.uploads.filter((p) => p === purpose).length === 1)
            throw new Error('Upload rate limited');
          return [{ id: purpose }];
        }
      });
      return r;
    },
    observe: (r, state) => {
      const snapshot = r.job.snapshot();
      assert.equal(snapshot.uploading, false);
      assert.equal(snapshot.linking, false);
      if (state === 'partial') {
        assert.equal(r.saved.frontPhotoId, 'intake_front');
        assert.equal(r.saved.backPhotoId, undefined);
        assert.equal(snapshot.canSkip, true);
      }
      if (state === 'complete') {
        assert.equal(r.saved.frontPhotoId, 'intake_front');
        assert.equal(r.saved.backPhotoId, 'intake_back');
        assert.equal(r.saved.canSupplement, false);
        assert.equal(r.uploads.filter((p) => p === 'intake_front').length, 1);
        assert.equal(r.uploads.filter((p) => p === 'intake_back').length, 2);
      }
    }
  });
}
