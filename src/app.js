import { createObservation } from './platform/observability.js';
import { ingestTelemetry } from './platform/telemetry-ingest.js';
import { createContext } from './context.js';
import { dispatch } from './routes/index.js';
import { validateEnv } from './lib/env.js';
import { fail, HttpError, json } from './lib/http.js';
import { conflictMessage, conflictCode } from './db/errors.js';

export async function handleRequest(request, env) {
  const observation = createObservation(request, env);
  let context, failure;
  const response = await (async () => {
    try {
      if (new URL(request.url).pathname === '/api/telemetry')
        return await ingestTelemetry(request, env);
      validateEnv(env);
      const origin = request.headers.get('origin');
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        origin &&
        origin !== new URL(request.url).origin
      )
        fail(403, '不允许跨站操作');
      context = createContext(request, env, observation);
      return await dispatch(context);
    } catch (error) {
      failure = error;
      if (error instanceof HttpError) {
        const code =
          error.code ||
          (error.status === 401
            ? 'SESSION_EXPIRED'
            : error.status === 403
              ? 'PERMISSION_REQUIRED'
              : error.status === 409
                ? 'REVISION_CONFLICT'
                : error.status === 400
                  ? 'VALIDATION_ERROR'
                  : undefined);
        failure = { name: error.name, code, stack: error.stack };
        return json(
          {
            error: error.message,
            ...(code ? { code } : {}),
            ...(error.fields ? { fields: error.fields } : {}),
            requestId: observation.requestId
          },
          error.status
        );
      }
      if (error instanceof URIError) {
        failure = { name: error.name, code: 'VALIDATION_ERROR', stack: error.stack };
        return json(
          { error: '路径编码不正确', code: 'VALIDATION_ERROR', requestId: observation.requestId },
          400
        );
      }
      const conflict = conflictMessage(error);
      if (conflict) {
        const code = conflict.includes('已有进行中的维修')
          ? 'ACTIVE_REPAIR_EXISTS'
          : conflictCode(error);
        failure = { name: error.name, code, stack: error.stack };
        return json({ error: conflict, code, requestId: observation.requestId }, 409);
      }
      return json({ error: '服务暂不可用，请稍后重试', requestId: observation.requestId }, 500);
    }
  })();
  return observation.finish(response, failure);
}
