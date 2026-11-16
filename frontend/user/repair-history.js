import { formatDate } from '/shared/time.js';
import { outcomeLabels,statusLabels } from '/shared/constants.js';
export function createRepairHistoryPanel(item) {
  const section=document.createElement('section');section.className='detail-section';
  const title=document.createElement('h2');title.textContent='关联服务记录';section.append(title);
  for(const entry of item.repairHistory?.items || []) {
    const row=document.createElement('article');
    const text=document.createElement('p');text.textContent=`${entry.id} · ${formatDate(entry.date)} · ${statusLabels[entry.status]}${entry.outcome ? ' · '+outcomeLabels[entry.outcome] : ''}`;row.append(text);
    if(entry.id!==item.id && entry.status==='booked') {
      const button=document.createElement('button');button.setAttribute('data-track','student.repair-history.dynamic.button');button.type='button';button.className='secondary-btn';button.textContent='出示该次服务维修码';button.dataset.relatedScan=entry.id;row.append(button,document.createElement('div'));
    }
    section.append(row);
  }
  const note=document.createElement('p');note.textContent='需要再次维修时，请正常预约或到场登记；工作人员核对原故障后关联工单。';section.append(note);
  return section;
}
