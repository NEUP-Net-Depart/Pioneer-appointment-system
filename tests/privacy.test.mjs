import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { decryptText, encryptText } from '../src/lib/privacy.js';

test('PII encryption keeps the existing AES-GCM format and reads legacy ciphertext', async () => {
  const key = randomBytes(32).toString('hex');
  const value = '历史联系方式：wechat-private';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const legacy = `enc$${iv.toString('base64url')}$${cipher.getAuthTag().toString('base64url')}$${ciphertext.toString('base64url')}`;

  assert.equal(await decryptText(legacy, key), value);
  const current = await encryptText(value, key);
  assert.match(current, /^enc\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await decryptText(current, key), value);
});
