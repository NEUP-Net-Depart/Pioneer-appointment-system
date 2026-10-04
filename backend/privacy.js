const crypto = require('node:crypto');

const PREFIX = 'enc$';

function encryptionKey() {
  const configured = process.env.PII_ENCRYPTION_KEY || '';
  if (configured) {
    if (!/^[0-9a-fA-F]{64}$/.test(configured)) throw new Error('PII_ENCRYPTION_KEY must be 64 hexadecimal characters');
    return Buffer.from(configured, 'hex');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('PII_ENCRYPTION_KEY must be set in production');
  return crypto.createHash('sha256').update('development-only-pioneer-pii-key').digest();
}

function encryptText(value) {
  const text = String(value ?? '');
  if (!text || text.startsWith(PREFIX)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}$${cipher.getAuthTag().toString('base64url')}$${ciphertext.toString('base64url')}`;
}

function decryptText(value) {
  const text = String(value ?? '');
  if (!text || !text.startsWith(PREFIX)) return text;
  try {
    const [, ivText, tagText, ciphertextText] = text.split('$');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '[联系方式不可解密]';
  }
}

module.exports = { encryptText, decryptText };
