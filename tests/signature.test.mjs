import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureDocument, validSignature, SIGNATURE_LIMITS } from '../shared/signature.js';

const signature = (
  strokes = [
    [
      [20, 20],
      [80, 20],
      [80, 80]
    ]
  ]
) => ({ version: 2, width: 300, height: 180, strokes });

test('versioned handwriting accepts real movement regardless of sampling frequency and isolated taps', () => {
  assert.equal(validSignature(signature()), true);
  assert.equal(
    validSignature(
      signature([
        [[5, 5]],
        [
          [20, 20],
          [80, 80]
        ]
      ])
    ),
    true
  );
  assert.equal(validSignature(signature([])), false);
  assert.equal(validSignature(signature([[[5, 5]], [[100, 100]]])), false);
  assert.equal(
    validSignature(signature([Array.from({ length: 200 }, (_, i) => [50 + (i % 2), 50])])),
    false
  );
});

test('signature validation rejects malformed, out-of-bounds and unbounded documents', () => {
  for (const value of [
    null,
    {},
    [
      [
        [0.1, 0.1],
        [0.9, 0.9]
      ]
    ],
    { ...signature(), version: 3 },
    { ...signature(), width: Infinity },
    { ...signature(), height: 0 },
    { ...signature(), width: SIGNATURE_LIMITS.dimension + 1 },
    { ...signature(), injectedStyle: 'red' },
    signature([[]]),
    signature([[[NaN, 20]]]),
    signature([[[20, 20, 20]]]),
    signature([
      [
        [-1, 20],
        [50, 50]
      ]
    ]),
    signature([[[301, 20]]]),
    signature(Array.from({ length: 101 }, () => [[1, 1]])),
    signature([Array.from({ length: 5001 }, () => [1, 1])])
  ]) {
    assert.equal(validSignature(value), false);
    assert.equal(signatureDocument(value), null);
  }
});
