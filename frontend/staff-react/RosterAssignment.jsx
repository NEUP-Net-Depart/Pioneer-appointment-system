import React from 'react';
import {StaffIdentity} from './StaffIdentity';

export function RosterAssignment({row,member,editable,protectedRow,onEdit}) {
  const name=member?.name||'资格已变化的成员';
  const content=<><span className="roster-person-copy"><strong>{name}</strong><StaffIdentity identities={member?.identities}/>{(row.locked||row.manualOverride||row.leaveStatus||protectedRow||row.roleKind==='coordinator')&&<span className="roster-person-notes">{row.roleKind==='coordinator'&&<span>协调人</span>}{row.locked&&<span>已锁定</span>}{row.manualOverride&&<span>人工安排</span>}{row.leaveStatus&&<span className="roster-gap">{row.leaveStatus==='approved'?'已请假':'请假审批中'}</span>}{protectedRow&&<span>原班次保留</span>}</span>}</span>{editable&&!protectedRow&&<span className="roster-person-edit" aria-hidden="true">调整</span>}</>;
  return <li className="roster-person" draggable={editable&&!protectedRow&&row.leaveStatus!=='approved'} onDragStart={event=>event.dataTransfer.setData('text/plain',row.memberId)}>{editable&&!protectedRow?<button className="roster-person-trigger" aria-label={row.leaveStatus==='approved'?`为${name}安排补位人员`:`调整${name}的安排`} onClick={onEdit}>{content}</button>:<div className="roster-person-trigger">{content}</div>}</li>;
}

export function RosterAssignmentControls({row,member,office,onChange,onReplace,onRemove}) {
  return <section className="roster-assignment-controls" aria-label="当前人员安排"><div><strong>{member?.name||'成员'}</strong><StaffIdentity identities={member?.identities}/><p>{row.businessDate} · {row.startAt}–{row.endAt}</p></div><div className="roster-assignment-options"><label><input type="checkbox" checked={!!row.locked} onChange={event=>onChange({...row,locked:event.target.checked})}/>锁定此班次</label>{office&&<label><input type="checkbox" checked={row.roleKind==='coordinator'} onChange={event=>onChange({...row,roleKind:event.target.checked?'coordinator':''})}/>设为当日协调人</label>}</div><p className="react-muted">锁定后重新自动排班会保留此安排。修改下方目标班次可移动人员。</p><div className="roster-assignment-actions"><button onClick={onReplace}>选择替换人员</button><button className="roster-remove-person" onClick={onRemove}>移除此安排</button></div></section>;
}

export function RosterReportedTimes({windows,title}) {
  return windows?.length>0?<details className="roster-reported-times"><summary>{title} · {windows.length} 个时段</summary><ul>{windows.map((slot,index)=><li key={index}><strong>{slot.businessDate?.slice(5).replace('-','/')}</strong><span>{({'campus-nanhu':'南湖','campus-hunnan':'浑南'})[slot.campusId]||slot.campusName||'指定校区'} · {slot.startAt}–{slot.endAt}</span></li>)}</ul></details>:null;
}
