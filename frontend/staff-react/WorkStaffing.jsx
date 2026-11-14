import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { ActivityContext } from './field/ui';
import { request } from './request.js';

export function useWorkStaffing(campusId, enabled = true) {
  const active = useContext(ActivityContext);
  return useQuery({
    queryKey: ['/api/attendance/staffing', { campusId }],
    queryFn: ({ signal }) =>
      request(`/api/attendance/staffing?campusId=${encodeURIComponent(campusId)}`, { signal }),
    enabled: active && enabled,
    refetchInterval: active ? 30000 : false
  });
}
