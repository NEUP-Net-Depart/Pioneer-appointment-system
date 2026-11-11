import { activeMemberships, additionalMembershipLabels, membershipLabel } from './staff-organization.js';

export function staffIdentities(context) {
  const identities=[{code:'staff',label:'工作人员'}];
  for(const post of activeMemberships(context)) {
    const code=additionalMembershipLabels[post.assignmentType]?post.assignmentType:post.positionCode;
    const label=membershipLabel(post);
    if(!identities.some(item=>item.code===code && item.label===label))identities.push({code,label});
  }
  if(context.actor?.role==='superadmin')identities.push({code:'superadmin',label:'系统管理员'});
  return identities;
}
