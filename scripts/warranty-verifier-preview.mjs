import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function startWarrantyVerifier() {
  const root = fileURLToPath(new URL('../warranty-verifier/', import.meta.url));
  let parentOrigin = '';
  const headers = await readFile(root + '_headers', 'utf8');
  const csp = headers.split('\n').find(line => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
  const paths = { '/index.html': ['index.html', 'text/html; charset=utf-8'], '/bridge.js': ['bridge.js', 'application/javascript'], '/style.css': ['style.css', 'text/css'] };
  const server = createServer(async (request, response) => {
    const file = paths[request.url];
    if (request.method !== 'GET' || !file) { response.writeHead(404).end(); return; }
    try {
      response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'Content-Security-Policy': csp + `; frame-ancestors ${parentOrigin || "'none'"}`, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      response.end(await readFile(root + file[0]));
    } catch { response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, setParentOrigin(value) { parentOrigin = new URL(value).origin; }, close: () => new Promise(resolve => server.close(resolve)) };
}
