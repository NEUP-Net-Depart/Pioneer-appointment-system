import type { PagesFunction } from '@cloudflare/workers-types';
import type { PioneerEnvironment } from '../../src/platform/environment.ts';
import { handleRequest } from '../../src/app.ts';

export const onRequest: PagesFunction<PioneerEnvironment> = ({ request, env }) =>
  handleRequest(request, env);
