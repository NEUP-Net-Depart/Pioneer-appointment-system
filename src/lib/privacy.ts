const encoder = new TextEncoder();
const decoder = new TextDecoder();

function keyBytes(key: string) {
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('Invalid PII encryption key');
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(key.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function base64urlEncode(bytes: Uint8Array<ArrayBuffer>) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64urlDecode(value: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid encrypted contact');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function importKey(key: string) {
  return crypto.subtle.importKey('raw', keyBytes(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(value: string|undefined, key: string) {
  if (!value) return '';
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await importKey(key), encoder.encode(value)));
  const tag = encrypted.slice(-16);
  const ciphertext = encrypted.slice(0, -16);
  return `enc$${base64urlEncode(iv)}$${base64urlEncode(tag)}$${base64urlEncode(ciphertext)}`;
}

export async function decryptText(value: string, key: string) {
  if (!value) return '';
  const [prefix, ivValue, tagValue, ciphertextValue] = value.split('$');
  if (prefix !== 'enc' || !ivValue || !tagValue || ciphertextValue === undefined) throw new Error('Invalid encrypted contact');
  const iv = base64urlDecode(ivValue);
  const tag = base64urlDecode(tagValue);
  const ciphertext = base64urlDecode(ciphertextValue);
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted contact');
  const encrypted = new Uint8Array(ciphertext.length + tag.length);
  encrypted.set(ciphertext);
  encrypted.set(tag, ciphertext.length);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await importKey(key), encrypted);
  return decoder.decode(decrypted);
}

export function readStoredContact(value: string, key: string) {
  return value?.startsWith('enc$') ? decryptText(value, key) : Promise.resolve(value || '');
}

export function normalizedContact(value: unknown) {
  return String(value || '').replace(/^(?:QQ|微信)[：:]\s*/i, '').trim().toLowerCase();
}

async function contactIndexKey(key: string) {
  keyBytes(key);
  const raw = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`pioneer-contact-search-v1:${key}`)
  );
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function contactSearchToken(value: string | null | undefined, key: string) {
  const signed = await crypto.subtle.sign('HMAC', await contactIndexKey(key), encoder.encode(normalizedContact(value)));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function contactSearchTokens(values: readonly (string | null | undefined)[], key: string) {
  return [...new Set(await Promise.all(values.filter((value) => normalizedContact(value))
    .map((value) => contactSearchToken(value, key))))];
}
