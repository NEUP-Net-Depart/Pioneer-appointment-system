import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedAppointment } from './helpers/database.mjs';
import { validSignature } from '../shared/signature.js';
import { signatureFixture } from './fixtures/signature.mjs';

for (const directory of ['migrations', 'database/staff-migrations']) {
  test(`${directory}: signature cutover preserves ordered strokes, current documents and missing evidence`, () => {
    const db = database(directory, '0053');
    try {
      const previous = [
        [
          [0.1, 0.2],
          [0.6, 0.4],
          [0.3, 0.8]
        ],
        [
          [0.5, 0.3],
          [0.9, 0.7]
        ]
      ];
      const current = JSON.stringify(signatureFixture());
      seedAppointment(db, { id: 'old-signature', signature: JSON.stringify(previous) });
      seedAppointment(db, { id: 'current-signature', signature: current });
      seedAppointment(db, { id: 'missing-signature', signature: '' });
      db.sqlite.exec(readFileSync(`${directory}/0053_signature_documents.sql`, 'utf8'));
      const read = (id) =>
        db.sqlite.prepare('SELECT signature FROM appointments WHERE id=?').get(id).signature;
      const converted = JSON.parse(read('old-signature'));
      assert.deepEqual(converted, {
        version: 2,
        width: 560,
        height: 200,
        strokes: previous.map((stroke) => stroke.map(([x, y]) => [x * 560, y * 200]))
      });
      assert.equal(validSignature(converted), true);
      assert.equal(read('current-signature'), current);
      assert.equal(read('missing-signature'), '');
    } finally {
      db.sqlite.close();
    }
  });
}
