export function conditionProviders() {
  return {
    ownResource: {
      code: 'ownResource', version: 1, description: '资源归属于当前成员',
      check: ({ actor, resource }) => !!actor?.memberId && actor.memberId === (resource?.memberId || resource?.assignedMemberId)
    },
    activeDutyRole: {
      code: 'activeDutyRole', version: 1, description: '当前成员在业务日期拥有有效岗位',
      check: ({ context, resource }) => {
        const duties = context?.todayDuties || [];
        if (!duties.length && !context?.todayDuty) return false;
        if (!resource?.campusId) return true;
        const names = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
        return duties.some(duty => duty.campusId === resource.campusId || names[duty.campusId] === names[resource.campusId] || duty.campusName === resource.campusId);
      }
    },
    activeDepartmentMembership: {
      code: 'activeDepartmentMembership', version: 1, description: '当前成员在业务日期具有有效任职',
      check: ({ context }) => (context?.memberships || []).some(item => item.active !== false)
    },
    repairWorkEligible: {
      code: 'repairWorkEligible', version: 1, description: '成员具备维修工作资格',
      check: ({ context }) => (context?.workProfiles || []).some(item => ['repair', 'exchange'].includes(item.profileCode))
    },
    attendanceEligible: {
      code: 'attendanceEligible', version: 1, description: '成员可参加该签到场次',
      check: ({ context }) => context?.attendanceEligible !== false
    },
    meetingParticipant: {
      code: 'meetingParticipant', version: 1, description: '成员在发布参会名单中',
      check: ({ context }) => context?.meetingParticipant === true
    },
    meetingOrganizer: {
      code: 'meetingOrganizer', version: 1, description: '成员是会议管理人或获授权负责人',
      check: ({ context }) => context?.meetingOrganizer === true
    }
  };
}
