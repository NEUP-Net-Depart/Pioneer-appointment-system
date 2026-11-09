import { QueryClient } from '@tanstack/react-query';
import { request } from './request.js';

export function createQueryClient(options = {}) {
  return new QueryClient({
    ...options,
    defaultOptions: {
      queries: {
        queryFn: ({ queryKey: [path, params], pageParam, signal }) => {
          const search = new URLSearchParams(params);
          if (pageParam) search.set('cursor', pageParam);
          return request(`${path}${search.size ? `?${search}` : ''}`, {
            signal,
            timeoutMs: 15000
          });
        },
        staleTime: 30000,
        gcTime: 5 * 60000,
        refetchInterval: 30000,
        refetchIntervalInBackground: false,
        retry: (count, error) => count < 1 && (!error.status || error.status >= 500)
      },
      mutations: { retry: false }
    }
  });
}
