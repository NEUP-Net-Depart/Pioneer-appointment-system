import type { QueryClientConfig } from '@tanstack/react-query';
import { failureFrom } from '../../shared/api-types.ts';
import { recentlyActive } from '../../shared/telemetry-client.ts';
import { QueryClient } from '@tanstack/react-query';
import { request } from './request.ts';

export function createQueryClient(options: QueryClientConfig = {}) {
  return new QueryClient({
    ...options,
    defaultOptions: {
      queries: {
        queryFn: ({ queryKey, pageParam, signal, client }) => {
          const [path, params] = queryKey;
          const search = new URLSearchParams(params as Record<string, string> | undefined);
          if (pageParam) search.set('cursor', String(pageParam));
          return request(`${path}${search.size ? `?${search}` : ''}`, {
            signal,
            timeoutMs: 15000,
            telemetryPoll: !!client.getQueryState(queryKey)?.dataUpdatedAt && !recentlyActive()
          });
        },
        staleTime: 30000,
        gcTime: 5 * 60000,
        refetchInterval: 30000,
        refetchIntervalInBackground: false,
        retry: (count, error) => {
          const status = failureFrom(error).status;
          return count < 1 && (!status || status >= 500);
        }
      },
      mutations: { retry: false }
    }
  });
}
