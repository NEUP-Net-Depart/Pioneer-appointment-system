import { DataValue } from '../DataValue';
import { useState } from 'react';
import { Modal, Notice, CredentialCard, Scanner, time } from './ui';
import { Repair } from './Repair';
import { Registration } from './Registration';
import type { Home } from './types';
import { WorkspaceHeader } from '../WorkspaceHeader';
import { StaffIdentity } from '../StaffIdentity';
import { useFieldWorkspace } from './useFieldWorkspace';
import { TodayScene } from './TodayScene';
import { PersonalScene } from './PersonalScene';
import { AttendanceActions } from './AttendanceActions';
import { CampusScope } from '../CampusScope.jsx';
import { RefreshButton } from '../WorkspaceToolbar.jsx';
import './field.css';
export function FieldApp({
  initial,
  onNavigate,
  workspaceLinks = [],
  requestedScene,
  onSceneChange,
  onContextChange,
  active = true,
  onLogout
}: {
  initial: Home;
  workspaceLinks?: { id: string; label: string; group?: string }[];
  requestedScene?: string | null;
  onSceneChange?: (scene: string) => void;
  onContextChange?: (resource: string, campusId: string) => void;
  active?: boolean;
  onLogout: () => void;
  onNavigate: (view: string) => void;
}) {
  const [customerCredential, setCustomerCredential] = useState<{
    id: string;
    accessToken: string;
  } | null>(null);
  const {
    scene,
    campus,
    setCampus,
    selected,
    setSelected,
    scanOpen,
    setScanOpen,
    registration,
    setRegistration,
    message,
    setMessage,
    token,
    setToken,
    checkToken,
    setCheckToken,
    checkResult,
    setCheckResult,
    checkPreview,
    busy,
    result,
    data,
    refresh,
    resolve,
    showAttendance,
    openAttendance,
    checkIn,
    campusName
  } = useFieldWorkspace({
    initial,
    onNavigate,
    workspaceLinks,
    requestedScene,
    onSceneChange,
    onContextChange,
    active,
    onLogout
  });
  return (
    <>
      <section className="field-content" aria-busy={result.isPending}>
        <WorkspaceHeader
          group={scene === 'mine' ? '我的' : '现场工作'}
          title={
            scene === 'mine'
              ? '个人中心'
              : (data?.contexts || initial.contexts).find((c) => c.id === scene)?.label ||
                '今日工作'
          }
        >
          <div className="field-scope">
            <span data-motion-value="text">{data?.businessDate || initial.businessDate}</span>
            <RefreshButton
              key={`${scene}:${campus}`}
              label={scene === 'mine' ? '刷新个人中心' : '刷新工作台'}
              compactOnMobile
              disabled={busy}
              onRefresh={refresh}
            />
          </div>
        </WorkspaceHeader>
        <Notice>{message || result.error?.message}</Notice>
        <CampusScope
          label={scene === 'mine' ? '签到校区' : '接待校区'}
          campuses={(data?.campuses || initial.campuses).map((item) => ({
            id: item.id,
            name: item.name
          }))}
          value={campus}
          disabled={busy}
          onChange={(id) => {
            setCampus(id);
            setCustomerCredential(null);
          }}
        />
        {(scene === 'today' || scene === 'mine') && (
          <AttendanceActions
            data={
              data || {
                ...initial,
                campusId: campus,
                attendance: initial.campusId === campus ? initial.attendance : undefined
              }
            }
            busy={busy || !data}
            onCheckIn={openAttendance}
            onShowCode={scene === 'today' ? showAttendance : undefined}
          />
        )}
        {!!data?.pendingCoverInvitations &&
          workspaceLinks.some((entry) => entry.id === 'duties') && (
            <section className="field-roster-todo" aria-label="待响应的换班邀请">
              <div>
                <strong data-motion-value="text">
                  {data.pendingCoverInvitations} 份换班邀请等待你确认
                </strong>
              </div>
              <button onClick={() => onNavigate('duties')}>查看邀请</button>
            </section>
          )}
        {scene === 'today' && (
          <TodayScene
            key={campus}
            active={active}
            busy={busy || !data}
            pending={!data}
            data={
              data || {
                ...initial,
                campusId: campus,
                appointments: [],
                repairs: [],
                pendingPhotos: []
              }
            }
            onSelect={setSelected}
            onScan={() => setScanOpen(true)}
            onRegister={() => setRegistration(true)}
          />
        )}
        {scene === 'mine' && (
          <PersonalScene
            initial={initial}
            onNavigate={onNavigate}
            workspaceLinks={workspaceLinks}
            onLogout={onLogout}
            data={
              data || {
                ...initial,
                campusId: campus,
                repairs: [],
                pendingPhotos: [],
                attendance: undefined
              }
            }
          />
        )}
        <footer className="field-footer">
          <span>
            更新于 <DataValue label="更新时间">{data ? time(data.updatedAt) : undefined}</DataValue>
          </span>
        </footer>
      </section>
      {checkResult && (
        <Modal
          title={checkResult.isExisting ? '你已完成到岗签到' : '到岗签到成功'}
          compact
          onClose={() => setCheckResult(null)}
        >
          <div className="field-checkin-result">
            <span className="react-eyebrow">工作人员到岗</span>
            <h2 data-motion-value="text">{initial.actor.name}</h2>
            <StaffIdentity
              identities={checkResult.identitySnapshot?.identities || data?.identities}
            />
            <p data-motion-value="text">
              {data?.campuses.find((item) => item.id === checkResult.campusId)?.name}校区 ·{' '}
              {checkResult.businessDate}
            </p>
            <strong data-motion-value="text">{time(checkResult.occurredAt)}</strong>
            {(checkResult.nonScheduled || checkResult.isExisting) && (
              <p data-motion-value="text" className="field-muted">
                {[
                  checkResult.nonScheduled ? '非排班到场参与工作' : '',
                  checkResult.isExisting ? '保留首次签到时间' : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <button className="field-primary" onClick={() => setCheckResult(null)}>
              返回工作台
            </button>
          </div>
        </Modal>
      )}
      {scanOpen && (
        <Modal title="扫一扫" onClose={() => setScanOpen(false)}>
          <Scanner onCode={resolve} />
          <Notice>{message}</Notice>
        </Modal>
      )}
      {checkToken && (
        <Modal title="确认到岗签到" compact onClose={() => setCheckToken('')}>
          <p>
            {checkPreview?.campusName}校区 · {checkPreview?.businessDate}
            <br />
            {checkPreview && `${time(checkPreview.startsAt)}–${time(checkPreview.endsAt)}`}
            <br />
            将以 {initial.actor.name} 的账号记录到岗。
          </p>
          <Notice>{message}</Notice>
          <button className="field-primary" disabled={busy} onClick={() => checkIn(checkToken)}>
            确认签到
          </button>
        </Modal>
      )}
      {token && (
        <Modal title="展示签到码" onClose={() => setToken(null)}>
          <CredentialCard
            kind="attendance"
            code={token.token}
            context={`${campusName}校区 · ${data?.businessDate || initial.businessDate}`}
          />
          <p data-motion-value="text" className="field-muted">
            有效至 {time(token.expiresAt)} · 更新签到码后旧码失效
          </p>
          <Notice>{message}</Notice>
          <div className="field-actions">
            <button disabled={busy} onClick={showAttendance}>
              更新签到码
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <Repair
          sidePanel={scene !== 'repair'}
          id={selected}
          key={selected}
          customerCredential={customerCredential?.id === selected ? customerCredential : null}
          onClose={() => setSelected('')}
        />
      )}
      {registration && (
        <Registration
          campus={campusName}
          onClose={() => setRegistration(false)}
          onDone={(id, accessToken) => {
            setCustomerCredential(accessToken ? { id, accessToken } : null);
            setRegistration(false);
            setSelected(id);
            setMessage('登记成功');
          }}
        />
      )}
    </>
  );
}
