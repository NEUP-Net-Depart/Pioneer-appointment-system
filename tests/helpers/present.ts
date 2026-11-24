import assert from 'node:assert/strict';

export function present<T>(value: T, message = 'Expected the test fixture to exist'): NonNullable<T> {
  assert.ok(value !== null && value !== undefined, message);
  return value;
}
