import { queueTicketLabel } from '../../../shared/reception.js';
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
  key,
  scene,
  setSelected,
  setScanOpen,
  setRegistration,
  setMessage,
  busy,
  data,
  refresh,
  resolve,
  openAttendance,
  presence,
  campusName
}: Props) {
  return (
    <>
      <section className="field-hero">
        <div>
          <div className="field-actions">
            <Status value={data.state} />
            <span className="field-muted">{campusName}校区</span>
            <StaffIdentity identities={data.identities} />
          </div>
          <h2>
            {data.currentRepair
              ? '当前维修'
              : data.pendingRepair
                ? '待接手设备'
                : data.state === 'unsigned'
                  ? '待签到'
                  : data.state === 'away'
                    ? '暂时离岗'
                    : data.state === 'available'
                      ? data.nextInQueue
                        ? '待接单'
                        : '空闲中'
                      : '暂无可接单任务'}
          </h2>
          <p className="field-state-note">
            {data.currentRepair
              ? `${data.currentRepair.brand} ${data.currentRepair.deviceModel} · ${data.currentRepair.faultType}`
              : data.pendingRepair
                ? `${queueTicketLabel(data.pendingRepair.reception?.ticket)} · ${data.pendingRepair.id} · ${data.pendingRepair.name || '请当面核对机主'} · ${data.pendingRepair.deviceModel} · ${data.pendingRepair.faultType}`
                : data.nextInQueue
                  ? `${queueTicketLabel(data.nextInQueue.reception?.ticket)} · ${data.nextInQueue.deviceModel} · ${data.nextInQueue.faultType}`
                  : data.reason || ''}
          </p>
        </div>
        <div className="field-hero-action">
          {data.currentRepair ? (
            <button className="field-primary" onClick={() => setSelected(data.currentRepair!.id)}>
              继续维修
            </button>
          ) : data.pendingRepair ? (
            <button className="field-primary" onClick={() => setSelected(data.pendingRepair!.id)}>
              核对设备并接手
            </button>
          ) : data.state === 'unsigned' && data.capability['attendance.self'] ? (
            <button className="field-primary" onClick={openAttendance} disabled={busy}>
              到岗签到
            </button>
          ) : data.state === 'away' ? (
            <button className="field-primary" disabled={busy} onClick={() => presence('available')}>
              返回岗位
            </button>
          ) : data.state === 'available' ? (
            <button
              className="field-primary"
              onClick={() => {
                setMessage('');
                if (data.nextInQueue) setSelected(data.nextInQueue.id);
                else setScanOpen(true);
              }}
            >
              {data.nextInQueue ? '处理队首工单' : '扫描维修码'}
            </button>
          ) : (
            <button onClick={refresh}>刷新工作状态</button>
          )}
        </div>
      </section>
      <div className="field-work-grid">
        <section className="field-card">
          <div className="field-section-heading">
            <h2>接待设备</h2>
          </div>
          <AppointmentLookup
            active={active && scene === 'repair'}
            disabled={busy}
            onSelect={resolve}
          />
          <div className="field-actions">
            <button
              disabled={data.state !== 'available'}
              onClick={() => {
                setMessage('');
                setScanOpen(true);
              }}
            >
              扫码 / 相册识别
            </button>
            {data.capability['onsite.create'] && (
              <button disabled={data.state !== 'available'} onClick={() => setRegistration(true)}>
                临时维修登记
              </button>
            )}
          </div>
        </section>
        <section className="field-card">
          <h2>
            {data.identities?.some((identity) => identity.code === 'exchange') &&
            !data.permissions['roster.read']
              ? '到岗参与维修'
              : '今日班次'}
          </h2>
          {data.todayDuties.length ? (
            data.todayDuties.map((d) => (
              <div key={d.id} className="field-shift">
                <strong>
                  {d.campusName} · {d.dutyType === 'office' ? '办公接待' : '维修值班'}
                </strong>
                <span>
                  {d.startAt}–{d.endAt}
                </span>
              </div>
            ))
          ) : (
            <p className="field-muted">
              {data.identities?.some((identity) => identity.code === 'exchange')
                ? '交流人员不参与维修排班、填报或换班。到场后扫描工作人员签到码，签到后即可参与维修。'
                : '今天没有排班。具备资格的成员仍可到场签到。'}
            </p>
          )}
          {data.state === 'available' && (
            <button className="field-text" disabled={busy} onClick={() => presence('away')}>
              暂时离岗
            </button>
          )}
        </section>
      </div>
    </>
  );
}
