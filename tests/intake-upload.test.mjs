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
