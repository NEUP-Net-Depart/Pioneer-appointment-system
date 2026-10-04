import { handleRequest } from '../../src/app.js';

export function onRequest({ request, env }) {
  return handleRequest(request, env);
}
