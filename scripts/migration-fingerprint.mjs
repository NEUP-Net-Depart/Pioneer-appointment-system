import { createHash } from 'node:crypto';

// Git may check SQL out as CRLF on Windows; the baseline records LF text.
// Normalize only line endings so changes to SQL still invalidate the fingerprint.
export function migrationFingerprint(content) {
  return createHash('sha256').update(content.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
}
