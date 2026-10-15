import { escapeHtml } from '/shared/utils.js';
import { statusLabels, outcomeLabels, terminalStatuses, endTimeLabels, expirationMessage } from '/shared/constants.js';
import { formatInstant } from '/shared/time.js';

export function renderScanDetails(container, item) {
  const rows = fields => fields.filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  const group = (title, fields, collapsed = false) => {
    const content = rows(fields);
    if (!content) return '';
    return `<section class="scan-panel scan-info-card">${collapsed ? `<details><summary>${title}</summary><dl>${content}</dl></details>` : `<h2>${title}</h2><dl>${content}</dl>`}</section>`;
  };
  container.innerHTML = `<section class="scan-panel scan-device-card">
    <div class="scan-device-heading"><span class="scan-status-pill" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status])}</span><span>${escapeHtml(item.campus)}校区</span></div>
    <h2>${escapeHtml([item.brand, item.deviceModel].filter(Boolean).join(' ') || item.deviceType)}</h2>
    <p class="scan-device-type">${escapeHtml(item.deviceType)}</p><p class="scan-order-code">${escapeHtml(item.id)}</p>
    <dl>${rows([['登记方式', item.source === 'onsite' ? '现场临时登记' : `${item.date} ${item.timeSlot}`], ['有效截止时间', item.expiresAt && formatInstant(item.expiresAt)], ['序列号', item.serial], ['是否在保', item.warranty]])}</dl>
    ${item.status === 'expired' ? `<p class="record-note">${expirationMessage}</p>` : ''}
  </section>` + group('故障信息', [['故障类型', item.faultType], ['液金散热',item.liquidMetal], ['Dell G15',item.dellG15], ['进液 / 摔过', item.liquidDrop], ['故障描述', item.issue], ['备注', item.note]]) +
    group('机主信息', [['机主', item.name], ['学号', item.studentId], ['学院 / 专业', item.college], ['QQ / 微信', item.social], ['联系邮箱',item.email], ['手机', item.phone]], true) +
    group('维修记录', [['维修人员', item.assignedTo], ['维修结果', item.outcome && outcomeLabels[item.outcome]], ['维修说明', item.repairNote], ['开始时间', item.startedAt && formatInstant(item.startedAt)], [endTimeLabels[item.status] || '结束时间', item.completedAt && formatInstant(item.completedAt)]], !terminalStatuses.includes(item.status));
}
