export function validateEnv(env) {
  if (!env.DB || !env.ATTACHMENTS || typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32 || !/^[a-f\d]{64}$/i.test(env.PII_ENCRYPTION_KEY || '')) {
    throw new Error('Missing DB / ATTACHMENTS binding or invalid runtime secrets');
  }
  storageLimit(env);
}

export function storageLimit(env) {
  const raw = env.MAX_R2_BYTES ?? '8589934592';
  const bytes = Number(raw);
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(bytes)) throw new Error('Invalid MAX_R2_BYTES');
  return bytes;
}
