import { AppointmentLookup } from './AppointmentLookup';
import { StaffIdentity } from '../StaffIdentity';
import { WarrantyLookupButton } from './WarrantyLookup';
import type { Appointment, Home } from './types';
import { CountBadge } from '../DataValue';

function Orders({
  title,
  items,
  empty,
  pending = false,
  onSelect
}: {
  title: string;
  items: Appointment[];
  empty: string;
  pending?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="field-card today-orders" aria-busy={pending}>
      <h2 className="today-section-title">
        {title}
        <CountBadge label={`${title}数量`} value={pending ? undefined : items.length} />
      </h2>
      {items.map((item) => (
        <button
          data-track="staff.field.todayscene.button.1"
          className="today-order"
          key={item.id}
          onClick={() => onSelect(item.id)}
        >
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
      {!items.length && (
        <p className="today-order-summary">
          <span
            className={pending ? 'today-pending-copy' : undefined}
            aria-hidden={pending || undefined}
          >
            {empty}
          </span>
        </p>
      )}
    </section>
  );
}

export function TodayScene({
  active,
  data,
  busy,
  pending = false,
  onSelect,
  onScan,
  onRegister
}: {
  active: boolean;
  data: Home;
  busy: boolean;
  pending?: boolean;
  onSelect: (id: string) => void;
  onScan: () => void;
  onRegister: () => void;
}) {
  const items = data.appointments || [];
  const waiting = items.filter(
    (item) => item.status === 'booked' && !item.receivedAt && item.date === data.businessDate
  );
  const received = items.filter((item) => item.status === 'booked' && item.receivedAt);
  const otherRepairs = items.filter(
    (item) => item.status === 'in_progress' && item.assignedMemberId !== data.actor.memberId
  );
  return (
    <div className="today-scene">
      <section className="field-card today-tools">
        <div className="today-toolbar">
          <StaffIdentity identities={data.identities} />
          <div className="field-actions">
            <button
              data-track="staff.field.todayscene.button.2"
              className="field-primary"
              disabled={busy}
              onClick={onScan}
            >
              扫码
            </button>
            {data.capability['onsite.create'] && (
              <button
                data-track="staff.field.todayscene.button.3"
                disabled={busy}
                onClick={onRegister}
              >
                现场登记
              </button>
            )}
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
        <Orders
          title="今日待接收"
          items={waiting}
          empty="今日没有待接收工单"
          pending={pending}
          onSelect={onSelect}
        />
        <Orders
          title="已接收待维修"
          items={received}
          empty="没有已接收待维修工单"
          pending={pending}
          onSelect={onSelect}
        />
        {data.capability['repair.start'] && (
          <Orders
            title="本人正在维修"
            items={data.repairs || []}
            empty="暂无进行中的维修"
            pending={pending}
            onSelect={onSelect}
          />
        )}
        {!!otherRepairs.length && (
          <Orders title="其他人员正在维修" items={otherRepairs} empty="" onSelect={onSelect} />
        )}
      </div>
      {!!data.pendingPhotos?.length && (
        <Orders title="待补传接收照片" items={data.pendingPhotos} empty="" onSelect={onSelect} />
      )}
    </div>
  );
}
