import { escapeHtml } from '/shared/utils.js';
import { formatDate,formatInstant,slotDeadline } from '/shared/time.js';
import { outcomeLabels,statusLabels,expirationMessage } from '/shared/constants.js';
export function timeSummary(item) {
  return `<strong><span>${escapeHtml(formatDate(item.date))}</span><span class="summary-slot">${escapeHtml(item.source==='onsite' ? '现场临时登记' : item.timeSlot)}</span></strong><p>${escapeHtml(item.campus)}校区</p><p class="location">${escapeHtml(item.location || item.locationSnapshot || '维修地点未记录，请联系工作人员')}</p>${item.locationChanged ? `<p class="is-error">维修地点已调整，请以最新地点为准。</p><p>原地点：${escapeHtml(item.locationSnapshot)}</p>` : ''}`;
}
export function rows(values){return values.filter(([,value])=>value!==undefined && value!==null && value!=='').map(([name,value])=>`<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');}
export function longText(label,value){if(!value)return '';const escaped=escapeHtml(value);return value.length>280 ? `<p class="record-note"><b>${escapeHtml(label)}：</b>${escapeHtml(value.slice(0,180))}…</p><details><summary>${escapeHtml(label)} · 展开全文</summary><p class="record-note">${escaped}</p></details>` : `<p class="record-note"><b>${escapeHtml(label)}：</b>${escaped}</p>`;}
export function informationGroups(item,{photos=true,device=true,contacts=true}={}){
  return (device ? `<section class="review-group"><h3>设备与故障</h3><dl>${rows([['设备类型',item.deviceType],['品牌',item.brand],['设备型号',item.deviceModel],['液金散热',item.liquidMetal],['Dell G15',item.dellG15],['是否在保',item.warranty],['故障分类',item.faultType],['历史序列号',item.serial],['历史进液／跌落',item.liquidDrop]])}</dl>${longText('故障描述与补充说明',item.issue)}${longText('历史备注',item.note)}${photos && item.photoCount ? `<p>已准备 ${item.photoCount} 张故障照片，预约成功后上传。</p>` : ''}</section>` : '') + (contacts ? `<section class="review-group"><h3>机主与联系方式</h3><dl>${rows([['姓名',item.name],['学号',item.studentId],['学院',item.college],['联系邮箱',item.email],[item.contactType==='qq' ? 'QQ' : '微信',item.contactValue],['历史手机号',item.phone],['历史 QQ／微信',!item.contactValue ? item.social : '']])}</dl></section>` : '');
}
export function statusExplanation(item) {
  if(item.status==='expired')return expirationMessage;
  if(item.status==='booked' && item.source==='onsite')return '本次为现场临时登记，请与现场工作人员保持联系。';
  if(item.status==='booked')return Date.parse(slotDeadline(item.date,item.timeSlot))<=(item.serverNow ? Date.parse(item.serverNow) : Date.now()) ? '预约到场时段已结束，如已到现场或需要协助，请联系工作人员。' : '请在所选时段内到场，实际维修时间视现场情况而定。';
  return item.status==='in_progress' ? '工作人员已记录维修开始。' : item.status==='cancelled' ? '本次预约已取消。如仍需维修，请重新预约。' : '本次维修已结束。';
}
export function repairRecord(item) {
  if(!['completed','in_progress','cancelled'].includes(item.status))return '';
  return `<section class="detail-section"><h2>${item.status==='completed' ? '维修结果' : '预约记录'}</h2>${item.status==='completed' ? `<p class="repair-result">${escapeHtml(outcomeLabels[item.outcome] || outcomeLabels.legacy_unknown)}</p>${longText('维修说明',item.repairNote)}` : ''}<dl>${rows(item.status==='cancelled' ? [['取消时间',formatInstant(item.completedAt)]] : [['实际开始时间',formatInstant(item.startedAt)],...(item.status==='completed' ? [['完成时间',formatInstant(item.completedAt)]] : [])])}</dl></section>`;
}
export const statusText=item=>statusLabels[item.status] || '状态未记录';
