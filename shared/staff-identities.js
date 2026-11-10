import { activeMemberships, positionLabels } from './staff-organization.js';

export function staffIdentities(context) {
  const identities=[{code:'staff',label:'工作人员'}];
  for(const post of activeMemberships(context)) {
    if(post.assignmentType==='maintenance_affairs') {
      if(!identities.some(item=>item.code==='maintenance_affairs'))identities.push({code:'maintenance_affairs',label:'维修事务'});
      continue;
    }
    const code=post.assignmentType==='exchange'?'exchange':post.positionCode;
    const label=post.assignmentType==='exchange'?`${post.departmentName}交流人员`:`${post.departmentName}${positionLabels[post.positionCode] || ''}`;
    if(!identities.some(item=>item.code===code && item.label===label))identities.push({code,label});
  }
  if(context.actor?.role==='superadmin')identities.push({code:'superadmin',label:'系统管理员'});
  return identities;
}
