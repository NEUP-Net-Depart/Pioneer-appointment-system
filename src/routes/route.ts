import type { createContext } from '../context.ts';

export type RequestContext = ReturnType<typeof createContext>;
export type Route = [
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  pattern: RegExp,
  handler: (context: RequestContext, match: RegExpMatchArray) => Response | Promise<Response>
];

// Unvalidated URL query values are strings. A service may also call its
// own query methods with boolean flags normalized by the route.
export type QueryParameters = Readonly<Record<string, string | boolean | undefined>>;
