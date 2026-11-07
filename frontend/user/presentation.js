import { escapeHtml } from '/shared/utils.js';
import { formatDate,formatInstant } from '/shared/time.js';
import { outcomeLabels,statusLabels,expirationMessage } from '/shared/constants.js';
export function timeLabel(item) {
  return item.source==='onsite' ? '现场临时登记' : item.timeSlot;
}
export function timeSummary(item) {
  return `<strong><span>${escapeHtml(formatDate(item.date))}</span><span class="summary-slot">${escapeHtml(timeLabel(item))}</span></strong><p>${escapeHtml(item.campus)}校区</p><p class="location">${escapeHtml(item.location || item.locationSnapshot || '维修地点未记录，请联系工作人员')}</p>${item.servicePaused ? '<p class="is-error">该预约日期暂停维修，请联系工作人员确认后续安排。</p>' : ''}${item.locationChanged ? `<p class="is-error">维修地点已调整，请以最新地点为准。</p><p>原地点：${escapeHtml(item.locationSnapshot)}</p>` : ''}`;
}
export function rows(values){return values.filter(([,value])=>value!==undefined && value!==null && value!=='').map(([name,value])=>`<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');}
export function longText(label,value){if(!value)return '';const escaped=escapeHtml(value);return value.length>280 ? `<p class="record-note"><b>${escapeHtml(label)}：</b>${escapeHtml(value.slice(0,180))}…</p><details><summary>${escapeHtml(label)} · 展开全文</summary><p class="record-note">${escaped}</p></details>` : `<p class="record-note"><b>${escapeHtml(label)}：</b>${escaped}</p>`;}
const answerLabel=value=>value==='unknown' ? '不清楚' : value;
export function informationGroups(item,{photos=true,device=true,contacts=true,detail=false}={}){
  const heading=detail ? 'h2' : 'h3';
  return (device ? `<section class="review-group"><${heading}>设备与故障</${heading}><dl>${rows([['设备类型',item.deviceType],['品牌',item.brand],['设备型号',item.deviceModel],['液金散热',answerLabel(item.liquidMetal)],['Dell G15',item.dellG15],['是否在保',answerLabel(item.warranty)],['故障分类',item.faultType],['历史序列号',item.serial],['历史进液／跌落',item.liquidDrop]])}</dl>${longText('故障描述与补充说明',item.issue)}${longText('历史备注',item.note)}${photos && item.photoCount ? `<p>已准备 ${item.photoCount} 张故障照片，预约成功后上传。</p>` : ''}</section>` : '') + (contacts ? `<section class="review-group"><${heading}>机主与联系方式</${heading}><dl>${rows([['姓名',item.name],['学号',item.studentId],['学院',item.college],['联系邮箱',item.email],[item.contactType==='qq' ? 'QQ' : '微信',item.contactValue],['历史手机号',item.phone],['历史 QQ／微信',!item.contactValue ? item.social : '']])}</dl></section>` : '');
}
export function statusExplanation(item) {
  if(item.status==='expired')return expirationMessage;
  if(item.status==='booked' && item.source==='onsite')return '本次为现场临时登记，请与现场工作人员保持联系。';
  if(item.status==='booked')return '请尽量在所选时段到场；预约当天其他时段到场也可沿用本单。';
  return '';
}
export function repairRecord(item) {
  if(!['completed','in_progress','cancelled'].includes(item.status))return '';
  return `<section class="detail-section"><h2>${item.status==='completed' ? '维修结果' : '预约记录'}</h2>${item.status==='completed' ? `<p class="repair-result">${escapeHtml(outcomeLabels[item.outcome] || outcomeLabels.legacy_unknown)}</p>` : ''}<dl>${rows(item.status==='cancelled' ? [['取消时间',formatInstant(item.completedAt)]] : [['实际开始时间',formatInstant(item.startedAt)],...(item.status==='completed' ? [['完成时间',formatInstant(item.completedAt)]] : [])])}</dl></section>`;
}
export const statusText=item=>statusLabels[item.status] || '状态未记录';
