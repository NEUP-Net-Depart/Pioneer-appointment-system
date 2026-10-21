import { StaffIdentity } from '../StaffIdentity';
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
        <div className="personal-identity">
          <span className="field-avatar" aria-hidden="true">
            {initial.actor.name.slice(-2)}
          </span>
          <div>
            <h2>{initial.actor.name}</h2>
            <StaffIdentity identities={data.identities} />
          </div>
        </div>
        <h3>今日安排</h3>
        {data.todayDuties.map((d) => (
          <div className="field-shift" key={d.id}>
            {d.campusName} · {d.startAt}–{d.endAt}
          </div>
        ))}
        {!data.todayDuties.length && <p className="personal-no-shift">暂无排班安排</p>}
        <div className="field-actions personal-actions">
          {workspaceLinks.some((entry) => entry.id === 'roster') && (
            <button onClick={() => onNavigate('roster')}>我的班次与申请</button>
          )}
          <button onClick={() => onNavigate('settings')}>账号安全</button>
          <button onClick={onLogout}>退出登录</button>
          {data.capability['attendance.self'] && (
            <button onClick={openAttendance} disabled={busy}>
              到岗签到
            </button>
          )}
        </div>
      </section>
      {(data.capability['members.manage'] || data.capability['roles.manage']) && (
        <section className="field-card">
          <h2>平台管理</h2>
          <div className="field-actions personal-actions">
            {data.capability['members.manage'] && (
              <button onClick={() => onNavigate('members')}>成员管理</button>
            )}
            {data.capability['roles.manage'] && (
              <button onClick={() => onNavigate('permissions')}>角色与授权</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
