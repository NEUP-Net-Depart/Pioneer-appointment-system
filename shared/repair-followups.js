// A scheduled request stays active until its repair finishes, is cancelled,
// or expires. Every round in the linked history uses the same rule.
export function activeRepairFollowup(history, now) {
  const items = new Map((history?.items || []).map((item) => [item.id, item]));
  return (history?.followups || []).find((request) => {
    if (request.status === 'pending') return true;
    if (request.status !== 'scheduled') return false;
    const child = items.get(request.scheduledAppointmentId);
    if (!child) return true;
    return child.status === 'in_progress' || (child.status === 'booked' &&
      (['queued','assigned'].includes(child.reception?.state) || !child.expiresAt || Date.parse(child.expiresAt) > Date.parse(now)));
  }) || null;
}
