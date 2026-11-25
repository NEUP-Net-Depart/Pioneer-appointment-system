import { failureFrom } from '../shared/api-types.ts';
import type { PhotoSide } from '../frontend/staff-react/field/intake-upload.ts';
import { present } from './helpers/present.ts';
import { modelEdges, runModel } from './fixtures/workflow-seed.ts';
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

type Receipt = { receivedAt: string; revision?: number; canSupplement: boolean; frontPhotoId?: string; backPhotoId?: string };
type UploadDependencies = {
  apiJson(path: string, options?: { method?: string; json?: Partial<Receipt> }): Promise<Receipt>;
  uploadAttachments?(order: { id: string }, files: File[], purpose: PhotoPurpose): Promise<{ id: string }[]>;
  onSaved?(): void;
};
type PhotoPurpose = `intake_${PhotoSide}`;

function uploadJob({ apiJson, uploadAttachments, onSaved = () => {} }: UploadDependencies) {
  const module: { exports: Partial<typeof import('../frontend/staff-react/field/intake-upload.ts')> } = { exports: {} };
  const imports = new Map<string, object>(Object.entries({
    '../../../shared/api-types.ts': { failureFrom },
    '../../../shared/api.ts': { apiJson },
    '../../../shared/attachments.ts': { uploadAttachments },
    './photos': { intakePhoto: async (file: File) => file }
  }));
  runInNewContext(code, {
    module,
    require: (name: string) => present(imports.get(name), `Unexpected import: ${name}`),
    sessionStorage: { getItem: () => 'test-session' },
    crypto,
    setTimeout,
    clearTimeout
  });
  return present(module.exports.intakeUpload)('test-order', onSaved);
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
  const { promise: front, resolve: releaseFront } = Promise.withResolvers<void>();
  let saved: Receipt & { revision: number } = { receivedAt: '2026-10-15T02:00:00Z', revision: 1, canSupplement: true };
  const uploads: string[] = [], requests: [method: string, path: string][] = [], linking: boolean[] = [];
  const job = uploadJob({
    apiJson: async (path, options = {}) => {
      requests.push([options.method || 'GET', path]);
      if (options.method === 'POST') {
        assert.equal(present(options.json).revision, saved.revision);
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

type UploadState = { requests: number; uploads: PhotoPurpose[]; saved: Receipt & { revision: number }; dispose(): void };
type UploadModel = UploadState & { job: ReturnType<typeof uploadJob> };

async function uploadModel() {
  const select = (r: UploadModel) => {
    for (const side of ['front', 'back'] as const) r.job.select(side, new File([side], side + '.png'));
  };
  const edges = modelEdges<UploadModel>([
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
  ]);
  await runModel<UploadModel>({
    name: 'intake-upload',
    initial: 'idle',
    edges,
    setup: async () => {
      const r: UploadState = {
        requests: 0,
        uploads: [],
        saved: { receivedAt: '2026-10-15T02:00:00Z', revision: 1, canSupplement: true },
        dispose() {}
      };
      const job = uploadJob({
        apiJson: async (_path, options = {}) => {
          r.requests++;
          if (options.method === 'POST') {
            assert.equal(present(options.json).revision, r.saved.revision);
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
      return {
        job,
        get requests() { return r.requests; },
        get uploads() { return r.uploads; },
        get saved() { return r.saved; },
        dispose: r.dispose
      };
    },
    observe: (r, state: string) => {
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
        assert.equal(r.uploads.filter((p: string) => p === 'intake_front').length, 1);
        assert.equal(r.uploads.filter((p: string) => p === 'intake_back').length, 2);
      }
    }
  });
}
