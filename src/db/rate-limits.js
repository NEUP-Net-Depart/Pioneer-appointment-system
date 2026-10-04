export function rateLimitRepository(db) {
  return {
    async count(key, now) {
      return (await db.prepare('SELECT count FROM rate_limits WHERE key=? AND expires_at>?').bind(key, now).first())?.count ?? 0;
    },
    async increment(key, now, seconds) {
      const results = await db.batch([
        db.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?)
          ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
          expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`).bind(key, now + seconds, now, now),
        db.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<=? LIMIT 100)').bind(now)
      ]);
      return results[0].results[0].count;
    }
  };
}
