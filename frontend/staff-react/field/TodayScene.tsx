import { AppointmentLookup } from './AppointmentLookup';
import { Status } from './ui';
import { StaffIdentity } from '../StaffIdentity';
import { WarrantyLookupButton } from './WarrantyLookup';
import type { Appointment, Home } from './types';

function Orders({
  title,
  items,
  empty,
  onSelect
}: {
  title: string;
  items: Appointment[];
  empty: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="field-card today-orders">
      <h2 className="today-section-title">
        {title}
        <span>{items.length}</span>
      </h2>
      {items.map((item) => (
        <button className="today-order" key={item.id} onClick={() => onSelect(item.id)}>
          <strong>
            {item.name} · {item.brand} {item.deviceModel || item.deviceType}
          </strong>
          <span className="today-order-number">{item.id}</span>
          <span>
            {item.date} · {item.timeSlot}
          </span>
          <span className="today-order-facts">
            <span>{item.faultType}</span>
            {item.receivedAt && <span>接收：{item.receivedByName || item.receivedBy}</span>}
            {item.assignedToName && <span>主修：{item.assignedToName}</span>}
          </span>
          <span className="today-order-action">
            查看工单 <span aria-hidden="true">→</span>
          </span>
        </button>
      ))}
      {!items.length && <p>{empty}</p>}
    </section>
  );
}

export function TodayScene({
  active,
  data,
  busy,
  onSelect,
  onScan,
  onRegister,
  openAttendance,
  showAttendance,
  presence
}: {
  active: boolean;
  data: Home;
  busy: boolean;
  onSelect: (id: string) => void;
  onScan: () => void;
  onRegister: () => void;
  openAttendance: () => void;
  showAttendance: () => void;
  presence: (state: string) => void;
}) {
  const items = data.appointments || [];
  const waiting = items.filter(
    (item) => item.status === 'booked' && !item.receivedAt && item.date === data.businessDate
  );
  const received = items.filter((item) => item.status === 'booked' && item.receivedAt);
  return (
    <div className="today-scene">
      <section className="field-card today-tools">
        <div className="today-toolbar">
          <StaffIdentity identities={data.identities} />
          <div className="field-actions">
            <button className="field-primary" onClick={onScan}>
              扫码
            </button>
            {data.capability['onsite.create'] && <button onClick={onRegister}>现场登记</button>}
            {data.capability['repair.start'] && <WarrantyLookupButton />}
          </div>
        </div>
        <AppointmentLookup
          active={active}
          disabled={busy}
          label="查找工单"
          onSelect={onSelect}
          campusId={data.campusId}
          searchCapabilities={data.searchCapabilities}
        />
      </section>
      <div className="field-work-grid today-work">
        <Orders title="今日待接收" items={waiting} empty="今日没有待接收工单" onSelect={onSelect} />
        <Orders
          title="已接收待维修"
          items={received}
          empty="没有已接收待维修工单"
          onSelect={onSelect}
        />
        {data.capability['repair.start'] && (
          <Orders
            title="本人正在维修"
            items={data.repairs || []}
            empty="暂无进行中的维修"
            onSelect={onSelect}
          />
        )}
      </div>
      {!!data.pendingPhotos?.length && (
        <Orders title="待补传接收照片" items={data.pendingPhotos} empty="" onSelect={onSelect} />
      )}
      {(data.capability['attendance.self'] ||
        data.presence ||
        data.capability['attendance.session.manage']) && (
        <section className="field-card today-attendance">
          <div className="today-attendance-copy">
            <div className="today-attendance-heading">
              <h2>签到与到岗</h2>
              <Status value={data.state} />
            </div>
            <p className="field-muted">请按实际到岗情况签到。</p>
          </div>
          <div className="field-actions">
            {!data.presence && data.capability['attendance.self'] && (
              <button disabled={busy} onClick={openAttendance}>
                到岗签到
              </button>
            )}
            {data.presence && (
              <button
                disabled={busy}
                onClick={() =>
                  presence(data.presence?.state === 'available' ? 'off_duty' : 'available')
                }
              >
                {data.presence.state === 'available' ? '离岗' : '返回岗位'}
              </button>
            )}
            {data.capability['attendance.session.manage'] && (
              <button disabled={busy} onClick={showAttendance}>
                展示签到码
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
