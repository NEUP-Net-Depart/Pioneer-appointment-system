import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifierHeaders } from './warranty-deploy.mjs';

export async function startWarrantyVerifier() {
  const root = fileURLToPath(new URL('../warranty-verifier/', import.meta.url));
  const headers = await readFile(root + '_headers', 'utf8');
  const csp = headers
    .split('\n')
    .find((line) => line.trim().startsWith('Content-Security-Policy:'))
    .trim()
    .slice('Content-Security-Policy:'.length)
    .trim();
  const state = await mkdtemp(join(tmpdir(), 'pioneer-e2e-verifier-'));
  const parentsFile = join(state, 'parents.txt');
  await writeFile(parentsFile, '', { mode: 0o600 });
  const paths = {
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/bridge.js': ['bridge.js', 'application/javascript'],
    '/style.css': ['style.css', 'text/css']
  };
  const server = createServer(async (request, response) => {
    const file = paths[request.url];
    if (request.method !== 'GET' || !file) {
      response.writeHead(404).end();
      return;
    }
    try {
      const parentOrigins = [
        ...new Set((await readFile(parentsFile, 'utf8')).trim().split(/\s+/).filter(Boolean))
      ];
      response.writeHead(200, {
        'Content-Type': file[1],
        'Cache-Control': 'no-store',
        'Content-Security-Policy': verifierHeaders(csp, parentOrigins),
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(await readFile(root + file[0]));
    } catch {
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    parentsFile,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(state, { recursive: true, force: true });
    }
  };
}
