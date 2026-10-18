import { createContext } from './context.js';
import { dispatch } from './routes/index.js';
import { validateEnv } from './lib/env.js';
import { fail, HttpError, json } from './lib/http.js';
import { conflictMessage } from './db/errors.js';

let lastRosterAutomation=0;
export async function handleRequest(request, env, execution={}) {
  let context;
  try {
    validateEnv(env);
    const origin = request.headers.get('origin');
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && origin && origin !== new URL(request.url).origin) fail(403, '不允许跨站操作');
    context = createContext(request, env);
    const response=await dispatch(context);
    if(response.ok&&env.STAFF_WORKFLOW_ENABLED==='true'&&context.url.pathname==='/api/roster-tasks'&&execution.waitUntil&&Date.now()-lastRosterAutomation>60000) {
      lastRosterAutomation=Date.now();
      execution.waitUntil(context.services.staffPlatform.processRosterAutomation().catch(error=>console.error('Roster automation failed',error.name)));
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      const code = error.code || (error.status === 401 ? 'SESSION_EXPIRED' : error.status === 403 ? 'PERMISSION_REQUIRED' : error.status === 409 ? 'REVISION_CONFLICT' : error.status === 400 ? 'VALIDATION_ERROR' : undefined);
      return json({ error: error.message, ...(code ? { code } : {}), ...(context?.requestId ? { requestId: context.requestId } : {}) }, error.status);
    }
    if (error instanceof URIError) return json({ error: '路径编码不正确', code: 'VALIDATION_ERROR', ...(context?.requestId ? { requestId: context.requestId } : {}) }, 400);
    const conflict = conflictMessage(error);
    if (conflict) {
      const code = conflict.includes('已有进行中的维修') ? 'ACTIVE_REPAIR_EXISTS' : 'REVISION_CONFLICT';
      return json({ error: conflict, code, ...(context?.requestId ? { requestId: context.requestId } : {}) }, 409);
    }
    console.error('API request failed', new URL(request.url).pathname, error.name);
    return json({ error: '服务暂不可用，请稍后重试', ...(context?.requestId ? { requestId: context.requestId } : {}) }, 500);
  }
}
