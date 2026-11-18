import { DataValue } from '../DataValue';
import { useState } from 'react';
import { Modal, Notice, CredentialCard, Scanner, time } from './ui';
import { Repair } from './Repair';
import { Registration } from './Registration';
import type { Home } from './types';
import { WorkspaceHeader } from '../WorkspaceHeader';
import { CheckInDialog } from './CheckInDialog';
import { useFieldWorkspace } from './useFieldWorkspace';
import { TodayScene } from './TodayScene';
import { PersonalScene } from './PersonalScene';
import { AttendanceActions } from './AttendanceActions';
import { CampusScope } from '../CampusScope.jsx';
import { RefreshButton } from '../WorkspaceToolbar.jsx';
import './field.css';
import { TodayWorkWindow } from './TodayWorkWindow';
export function FieldApp({
  initial,
  onNavigate,
  workspaceLinks = [],
  requestedScene,
  onSceneChange,
  onContextChange,
  active = true,
  onLogout,
  onPeople
}: {
  initial: Home;
  workspaceLinks?: { id: string; label: string; group?: string }[];
  requestedScene?: string | null;
  onSceneChange?: (scene: string) => void;
  onContextChange?: (resource: string, campusId: string) => void;
  active?: boolean;
  onLogout: () => void;
  onNavigate: (view: string) => void;
  onPeople?: (campusId: string, kind: string) => void;
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
    busy,
    result,
    data,
    refresh,
    resolve,
    showAttendance,
    openAttendance,
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
        {scene === 'today' ? (
          <TodayWorkWindow
            data={
              data || {
                ...initial,
                campusId: campus,
                attendance: initial.campusId === campus ? initial.attendance : null,
                todayDuties: initial.campusId === campus ? initial.todayDuties : []
              }
            }
            busy={busy || !data}
            onCampus={(id) => {
              setCampus(id);
              setCustomerCredential(null);
            }}
            onScan={() => setScanOpen(true)}
            onCheckIn={openAttendance}
            onShowCode={showAttendance}
            onRefresh={refresh}
            onPeople={(kind) => onPeople?.(campus, kind)}
          />
        ) : (
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
                data-track="staff.field.fieldapp.button.3"
                key={`${scene}:${campus}`}
                label={scene === 'mine' ? '刷新个人中心' : '刷新工作台'}
                compactOnMobile
                disabled={busy}
                onRefresh={refresh}
              />
            </div>
          </WorkspaceHeader>
        )}
        <Notice>{message || result.error?.message}</Notice>
        {scene !== 'today' && (
          <CampusScope
            data-track="staff.field.fieldapp.select.1"
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
        )}
        {scene === 'mine' && (
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
              <button
                data-track="staff.field.fieldapp.button.2"
                onClick={() => onNavigate('duties')}
              >
                查看邀请
              </button>
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
      {scanOpen && (
        <Modal title="扫一扫" onClose={() => setScanOpen(false)}>
          <Scanner onCode={resolve} />
          <Notice>{message}</Notice>
        </Modal>
      )}
      {checkToken && (
        <CheckInDialog
          home={data || initial}
          token={checkToken === 'direct' ? '' : checkToken}
          onClose={() => setCheckToken('')}
          onComplete={(record) => {
            setCheckToken('');
            setMessage(
              record.isExisting ? '已读取首次签到记录' : `签到成功 · ${time(record.occurredAt)}`
            );
          }}
        />
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
            <button
              data-track="staff.field.fieldapp.button.6"
              disabled={busy}
              onClick={showAttendance}
            >
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
