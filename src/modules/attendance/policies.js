export function dutyPolicy() {
  return {
    code: 'duty', version: '1.0.0',
    resolveSource: event => ({ module: 'duty', type: 'assignment', id: event.sourceRef?.id || event.id }),
    checkEligibility: ({ event, context }) => event.type === 'duty' && context?.attendanceEligible !== false,
    getDedupeScope: ({ memberId, event }) => `duty:${memberId}:${event.businessDate}`,
    prepareEffects: ({ memberId, event, occurredAt }) => ({ memberId, businessDate: event.businessDate, campusId: event.campusId, occurredAt }),
    describeResult: record => ({ type: 'duty', label: '值班签到', recordId: record.id })
  };
}

export function meetingPolicy() {
  return {
    code: 'meeting', version: '1.0.0',
    resolveSource: event => ({ module: 'meetings', type: 'meeting', id: event.sourceRef?.id || event.id }),
    checkEligibility: ({ event, context }) => {
      if (event.type !== 'meeting') return false;
      if (context?.meetingParticipant === true) return true;
      const participants = event.ruleSnapshot?.participantMemberIds || event.sourceRef?.participantMemberIds || [];
      return Array.isArray(participants) && participants.includes(context?.actor?.memberId);
    },
    getDedupeScope: ({ memberId, event }) => `meeting:${memberId}:${event.id}`,
    prepareEffects: ({ memberId, event, occurredAt }) => ({ memberId, eventId: event.id, occurredAt }),
    describeResult: record => ({ type: 'meeting', label: '会议签到', recordId: record.id })
  };
}
