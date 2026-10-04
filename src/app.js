import { createContext } from './context.js';
import { dispatch } from './routes/index.js';
import { validateEnv } from './lib/env.js';
import { fail, HttpError, json } from './lib/http.js';
import { conflictMessage } from './db/errors.js';

export async function handleRequest(request, env) {
  try {
    validateEnv(env);
    const origin = request.headers.get('origin');
    if (['POST','PATCH','DELETE'].includes(request.method) && origin && origin !== new URL(request.url).origin) fail(403, '不允许跨站操作');
    return await dispatch(createContext(request, env));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof URIError) return json({ error: '路径编码不正确' }, 400);
    const conflict = conflictMessage(error);
    if (conflict) return json({ error: conflict }, 409);
    console.error('API request failed', new URL(request.url).pathname, error.name);
    return json({ error: '服务暂不可用，请稍后重试' }, 500);
  }
}
