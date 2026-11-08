import { handleRequest } from '../../src/app.js';

export function onRequest({ request, env, waitUntil }) {
  return handleRequest(request, env, {waitUntil});
}
