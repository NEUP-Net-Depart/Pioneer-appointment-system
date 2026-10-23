import { formatDate } from '/shared/time.js';
import { statusText } from './presentation.js';
import { outcomeLabels } from '/shared/constants.js';

const requestState = {
  pending: '等待办公人员安排',
  scheduled: '已安排维修',
  rejected: '申请已退回'
};
const eventLabel = {
  'repairs.claimed': '维修人员接单',
  'repairs.transferred': '工单已转交',
  'repairs.started': '开始维修',
  'repairs.completed': '维修完成',
  'repairs.corrected': '管理员修正记录'
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createFollowupPanel(item, message = '') {
  const history = item.repairHistory || { items: [], followups: [], events: [] };
  const related = [...history.items].sort((a, b) =>
    (a.createdAt || a.date).localeCompare(b.createdAt || b.date) || a.id.localeCompare(b.id)
  );
  const itemById = new Map(related.map((entry) => [entry.id, entry]));
  const section = element('section', 'detail-section repair-history-section');
  section.setAttribute('aria-labelledby', 'repair-history-title');
  const title = element('h2', '', '返修与维修记录');
  title.id = 'repair-history-title';
  section.append(title, element('p', 'field-hint', '每轮返修使用独立单号，并与原工单关联。'));
  const rounds = element('div', 'repair-history-list');
  if (!related.length) rounds.append(element('p', 'field-hint', '暂无维修轮次记录。'));

  related.forEach((entry, index) => {
    const round = element('article', 'repair-round');
    const heading = element('div', 'repair-round-heading');
    heading.append(element('strong', '', '第 ' + (index + 1) + ' 轮维修'), element('span', '', entry.id));
    round.append(heading);
    round.append(element('p', 'repair-round-time',
      formatDate(entry.date) + ' · ' + entry.timeSlot + ' · ' + statusText(entry)));
    if (entry.outcome) round.append(element('p', 'repair-round-result',
      outcomeLabels[entry.outcome] || outcomeLabels.legacy_unknown));
    if (entry.repairNote) round.append(element('p', 'repair-round-note', entry.repairNote));
    const events = history.events.filter((event) => event.appointmentId === entry.id);
    if (events.length) {
      const list = element('ol', 'repair-round-events');
      events.forEach((event) => {
        const line = element('li');
        const label = eventLabel[event.action] || '工单更新';
        line.append(element('span', '', label + (event.assigneeName ? ' · ' + event.assigneeName : '')));
        const time = element('time', '', new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
        line.append(time);
        if (event.reason) line.append(element('p', '', event.reason));
        list.append(line);
      });
      round.append(list);
    }

    history.followups
      .filter((request) => request.parentAppointmentId === entry.id)
      .forEach((request) => {
        const followup = element('section', 'repair-followup-entry');
        const row = element('div', 'repair-followup-heading');
        row.append(element('strong', '', requestState[request.status] || '状态已更新'));
        row.append(element('time', '', new Date(request.requestedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })));
        followup.append(row, element('p', '', request.reason));
        if (request.resolutionNote) followup.append(element('p', 'repair-followup-resolution', '处理说明：' + request.resolutionNote));
        const child = itemById.get(request.scheduledAppointmentId);
        if (child) {
          followup.append(element('p', '', '返修单 ' + child.id + ' · ' + formatDate(child.date) + ' ' + child.timeSlot));
          if (child.status === 'booked' && request.status === 'scheduled') {
            const showQr = element('button', 'secondary-btn', '显示返修维修码');
            showQr.type = 'button';
            showQr.dataset.followupQr = request.id;
            showQr.dataset.followupAppointment = child.id;
            followup.append(showQr);
            const qr = element('div', 'followup-qr-container');
            qr.dataset.followupQrContainer = request.id;
            followup.append(qr);
          }
        }
        round.append(followup);
      });
    rounds.append(round);
  });
  section.append(rounds);

  const pending = history.followups.some((request) =>
    request.parentAppointmentId === item.id && request.status === 'pending'
  );
  if (pending) section.append(element('p', 'followup-pending-message',
    '返修申请已提交，办公人员安排后会在此显示日期与返修单号。'));
  if (item.status === 'completed' && !pending) {
    const form = element('form', 'customer-followup-form');
    form.dataset.followupForm = '';
    const label = element('label', 'field', '返修情况');
    const textarea = document.createElement('textarea');
    textarea.name = 'reason';
    textarea.rows = 4;
    textarea.maxLength = 3000;
    textarea.required = true;
    textarea.setAttribute('aria-describedby', 'followup-help');
    textarea.placeholder = '请说明原故障是否复现、当前表现以及方便核实的信息';
    label.append(textarea);
    form.append(label);
    const help = element('p', 'field-hint', '申请提交后由办公人员安排返修日期；返修单会关联本次维修记录。');
    help.id = 'followup-help';
    form.append(help);
    const status = element('p', 'followup-submit-message', message);
    status.setAttribute('role', 'status');
    form.append(status);
    const submit = element('button', 'primary-btn', '提交返修申请');
    submit.type = 'submit';
    form.append(submit);
    section.append(form);
  }
  return section;
}
