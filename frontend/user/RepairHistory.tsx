import { useState } from 'react';
import { formatDate } from '../../shared/time.js';
import { statusText } from './presentation';
import { RepairQr } from './RepairQr';
import type { Appointment } from './types';

function RelatedService({ entry, item }: { entry: Appointment; item: Appointment }) {
  const [request, setRequest] = useState(0);
  return (
    <article>
      <p>
        {entry.id} · {formatDate(entry.date)} · {statusText(entry.id === item.id ? item : entry)}
      </p>
      {entry.id !== item.id && entry.status === 'booked' && (
        <>
          <button
            data-track="student.repair-history.dynamic.button"
            type="button"
            className="secondary-btn"
            data-related-scan={entry.id}
            onClick={() => setRequest((value) => value + 1)}
          >
            出示该次服务维修码
          </button>
          <div>
            {request > 0 && (
              <RepairQr
                key={request}
                item={{ id: entry.id, accessToken: item.accessToken }}
                parentId={item.id}
              />
            )}
          </div>
        </>
      )}
    </article>
  );
}

export function RepairHistory({ item }: { item: Appointment }) {
  const history = item.repairHistory?.items || [];
  if (history.length < 2) return null;
  return (
    <section
      className="appointment-detail-section"
      data-repair-history="true"
      data-signature={JSON.stringify(item.repairHistory)}
    >
      <h2>关联服务记录</h2>
      {history.map((entry) => (
        <RelatedService key={entry.id} entry={entry} item={item} />
      ))}
      <p>需要再次维修时，请正常预约或到场登记；工作人员核对原故障后关联工单。</p>
    </section>
  );
}
