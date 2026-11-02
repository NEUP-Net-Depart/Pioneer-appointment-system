import { WorkspaceIcon } from '../WorkspaceIcon';
import { PersonalProfile } from './PersonalProfile';
import type { useFieldWorkspace } from './useFieldWorkspace';
type Props = Pick<
  ReturnType<typeof useFieldWorkspace> & Parameters<typeof useFieldWorkspace>[0],
  | 'initial'
  | 'onNavigate'
  | 'workspaceLinks'
  | 'onLogout'
  | 'key'
  | 'busy'
  | 'data'
  | 'openAttendance'
  | 'campusName'
>;
export function PersonalScene({
  initial,
  onNavigate,
  workspaceLinks,
  onLogout,
  key,
  busy,
  data,
  openAttendance,
  campusName
}: Props) {
  return (
    <div className="field-work-grid personal-workspace">
      <section className="field-card personal-schedule">
        <PersonalProfile initialName={initial.actor.name} identities={data.identities} />
        <h3>今日安排</h3>
        {data.todayDuties.map((d) => (
          <div data-motion-item="" className="field-shift" key={d.id}>
            {d.campusName} · {d.startAt}–{d.endAt}
          </div>
        ))}
        {!data.todayDuties.length && <p className="personal-no-shift">暂无排班安排</p>}
        <div className="field-actions personal-actions">
          {!data.presence &&
            (data.capability['attendance.self'] || data.directAttendance?.allowed) && (
              <button className="field-primary" onClick={openAttendance} disabled={busy}>
                到岗签到
              </button>
            )}
          <button onClick={onLogout}>退出登录</button>
        </div>
      </section>
      <section className="field-card">
        <h2>我的工作</h2>
        <div className="personal-shortcuts">
          {[
            { id: 'roster', label: '我的班次与申请', icon: 'calendar' },
            { id: 'attendance', label: '本人签到记录', icon: 'check' },
            { id: 'settings', label: '账号安全', icon: 'shield' }
          ]
            .filter((item) => workspaceLinks.some((entry) => entry.id === item.id))
            .map((item) => (
              <button key={item.id} onClick={() => onNavigate(item.id)}>
                <WorkspaceIcon name={item.icon} />
                {item.label}
                <span aria-hidden="true">→</span>
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
