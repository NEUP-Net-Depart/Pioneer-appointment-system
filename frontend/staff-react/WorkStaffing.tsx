import type { ItemsResponse } from '../../shared/api-types.ts';

type StaffingMember = { memberId: string; name: string };
export interface WorkStaffingResponse {
  campusId: string;
  businessDate: string;
  idle: ItemsResponse<StaffingMember>['items'];
  missing: StaffingMember[] | null;
}
import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { ActivityContext } from './field/ui';
import { request } from './request.ts';

export function useWorkStaffing(campusId: string, enabled = true) {
  const active = useContext(ActivityContext);
  return useQuery<WorkStaffingResponse>({
    queryKey: ['/api/attendance/staffing', { campusId }],
    queryFn: ({ signal }) =>
      request(`/api/attendance/staffing?campusId=${encodeURIComponent(campusId)}`, { signal }),
    enabled: active && enabled,
    refetchInterval: active ? 30000 : false
  });
}
