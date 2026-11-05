import { leadershipPositions } from '../../../shared/staff-organization.js';
import { participationCodes } from '../../../shared/staff-organization.js';
import { staffIdentities } from '../../../shared/staff-identities.js';

export function rosterFactContext(fact, businessDate) {
  const active = item => (!item.effectiveFrom || item.effectiveFrom <= businessDate) && (!item.effectiveTo || businessDate < item.effectiveTo);
  return {businessDate,actor:{memberId:fact.memberId,role:fact.role,authorizedCampuses:fact.campuses || []},
    memberships:(fact.memberships || []).filter(active),
    todayDuties:[]};
}

export function repairRosterPool(fact, authorizer, businessDate, target = {}) {
  const context = rosterFactContext(fact,businessDate);
  if (!fact.active || participationCodes(context, target).includes('exchange')) return '';
  if (staffIdentities(context,authorizer,target).some(item=>leadershipPositions.includes(item.code))) return 'lead';
  return participationCodes(context, target).includes('repair') ? 'ordinary' : '';
}

export function rosterParticipation(fact, day, target = {}) {
  return participationCodes(rosterFactContext(fact || {}, day), target);
}
