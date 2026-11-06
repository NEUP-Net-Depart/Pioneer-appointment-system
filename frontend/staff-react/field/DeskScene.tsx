import { Status } from './ui';
import { AppointmentLookup } from './AppointmentLookup';
import type { useFieldWorkspace } from './useFieldWorkspace';
type Props = Pick<
  ReturnType<typeof useFieldWorkspace> & Parameters<typeof useFieldWorkspace>[0],
  | 'key'
  | 'active'
  | 'setSelected'
  | 'setRegistration'
  | 'setScanOpen'
  | 'busy'
  | 'filter'
  | 'setFilter'
  | 'setSearch'
  | 'result'
  | 'data'
  | 'showAttendance'
  | 'items'
>;
export function DeskScene({
  active,
  setSelected,
  setRegistration,
  setScanOpen,
  busy,
  filter,
  setFilter,
  setSearch,
  data,
  showAttendance,
  items
}: Props) {
  return (
    <>
      <section className="field-card">
        <div className="field-actions">
          <button className="field-primary" onClick={() => setScanOpen(true)}>
            扫描客户维修码
          </button>
          <button onClick={() => setRegistration(true)}>现场登记</button>
          {data.capability['attendance.session.manage'] && (
            <button disabled={busy} onClick={showAttendance}>
              展示签到码
            </button>
          )}
        </div>
      </section>
      <section className="field-card">
        <h2>今日工单及跨日维修</h2>
        <AppointmentLookup
          active={active}
          disabled={busy}
          onSelect={setSelected}
          onChange={setSearch}
          campusId={data.campusId}
          searchCapabilities={data.searchCapabilities}
        />
        <label>
          状态
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="booked">待接单</option>
            <option value="in_progress">维修中</option>
            <option value="completed">服务已结束</option>
          </select>
        </label>
        {items.map((item) => (
          <button className="field-order" key={item.id} onClick={() => setSelected(item.id)}>
            <strong>{item.deviceModel || item.deviceType}</strong>
            <span>
              {item.id} · {item.date}
            </span>
            <Status value={item.status} />
            <span>{item.assignedToName || (item.receivedAt ? '已接收' : '尚未接收')}</span>
          </button>
        ))}
        {!items.length && <p>暂无符合条件的工单</p>}
      </section>
    </>
  );
}
