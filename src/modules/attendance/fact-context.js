export function attendanceFactContext(fact, businessDate) {
  const active = item => (!item.effectiveFrom || item.effectiveFrom <= businessDate) && (!item.effectiveTo || businessDate < item.effectiveTo);
  return {businessDate,actor:{memberId:fact.memberId,role:fact.role,authorizedCampuses:fact.campuses || []},
    memberships:(fact.memberships || []).filter(active),
    todayDuties:[]};
}

