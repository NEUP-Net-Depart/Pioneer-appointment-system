import { Status } from './ui';
import { AppointmentLookup } from './AppointmentLookup';
import { StaffIdentity } from '../StaffIdentity';
import type { useFieldWorkspace } from './useFieldWorkspace';
type Props = Pick<
  ReturnType<typeof useFieldWorkspace> & Parameters<typeof useFieldWorkspace>[0],
  | 'active'
  | 'key'
  | 'scene'
  | 'setSelected'
  | 'setScanOpen'
  | 'setRegistration'
  | 'setMessage'
  | 'busy'
  | 'data'
  | 'refresh'
  | 'resolve'
  | 'openAttendance'
  | 'presence'
  | 'campusName'
>;
export function RepairScene({
  active,
  setSelected,
  setScanOpen,
  setRegistration,
  busy,
  data,
  resolve,
  openAttendance,
  presence,
  campusName
}: Props) {
  return (
    <>
      <section className="field-hero">
        <div>
          <h2>{campusName}维修工作台</h2>
          <StaffIdentity identities={data.identities} />
        </div>
        <div className="field-actions">
          <button className="field-primary" onClick={() => setScanOpen(true)}>
            扫描维修码
          </button>
          <button onClick={() => setRegistration(true)}>现场登记</button>
        </div>
      </section>
      <section className="field-card">
        <h2>查找工单与历史</h2>
        <AppointmentLookup
          active={active}
          disabled={busy}
          onSelect={resolve}
          campusId={data.campusId}
          searchCapabilities={data.searchCapabilities}
        />
      </section>
      <section className="field-card">
        <h2>本人正在维修 · {data.repairs?.length || 0}</h2>
        {(data.repairs || []).map((item) => (
          <button className="field-order" key={item.id} onClick={() => setSelected(item.id)}>
            <strong>
              {item.brand} {item.deviceModel || item.deviceType}
            </strong>
            <span>
              {item.id} · {item.date}
            </span>
            <span>{item.faultType}</span>
          </button>
        ))}
        {!data.repairs?.length && <p>暂无进行中的维修</p>}
      </section>
      <section className="field-card">
        <h2>待传照片</h2>
        {(data.pendingPhotos || []).map((item) => (
          <button key={item.id} onClick={() => setSelected(item.id)}>
            {item.id} · 待传
          </button>
        ))}
        {!data.pendingPhotos?.length && <p>没有待补传照片</p>}
      </section>
      <section className="field-card">
        <h2>考勤</h2>
        <Status value={data.state} />
        {!data.presence ? (
          <button disabled={busy} onClick={openAttendance}>
            到岗签到
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() =>
              presence(data.presence?.state === 'available' ? 'off_duty' : 'available')
            }
          >
            {data.presence?.state === 'available' ? '离岗' : '返回岗位'}
          </button>
        )}
      </section>
    </>
  );
}
