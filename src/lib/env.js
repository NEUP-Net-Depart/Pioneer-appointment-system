export function validateEnv(env) {
  if (!env.DB || !env.ATTACHMENTS || typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32 || !/^[a-f\d]{64}$/i.test(env.PII_ENCRYPTION_KEY || '')) {
    throw new Error('Missing DB / ATTACHMENTS binding or invalid runtime secrets');
  }
}
