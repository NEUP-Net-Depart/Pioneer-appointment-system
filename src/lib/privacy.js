import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';

export function encryptText(value, key) {
  if (!value) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `enc$${iv.toString('base64url')}$${cipher.getAuthTag().toString('base64url')}$${ciphertext.toString('base64url')}`;
}
export function decryptText(value, key) {
  if (!value) return '';
  const [prefix, iv, tag, ciphertext] = value.split('$');
  if (prefix !== 'enc') throw new Error('Invalid encrypted contact');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
