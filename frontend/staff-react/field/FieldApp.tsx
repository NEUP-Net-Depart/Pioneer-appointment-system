import { DataFields } from '../DataValue';
import { useState } from 'react';
import { Empty, Modal, Notice, CredentialCard, Scanner, time } from './ui';
import { Repair } from './Repair';
import { Registration } from './Registration';
import type { Home } from './types';
import { WorkspaceHeader } from '../WorkspaceHeader';
import { StaffIdentity } from '../StaffIdentity';
import { useFieldWorkspace } from './useFieldWorkspace';
import { RepairScene } from './RepairScene';
import { DeskScene } from './DeskScene';
import { PersonalScene } from './PersonalScene';
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
  onContextChange?: (home: Home) => void;
  active?: boolean;
  onLogout: () => void;
  onNavigate: (view: string) => void;
}) {
  const [customerCredential, setCustomerCredential] = useState<{
    id: string;
    accessToken: string;
  } | null>(null);
  const {
    key,
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
    filter,
    setFilter,
    search,
    setSearch,
    tab,
    setTab,
    showAvailable,
    setShowAvailable,
    peopleQuery,
    setPeopleQuery,
    result,
    data,
    refresh,
    resolve,
    showAttendance,
    openAttendance,
    checkIn,
    presence,
    items,
    people,
    visiblePeople,
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
      <section className="field-content" aria-busy={result.loading}>
        <WorkspaceHeader
          group={scene === 'mine' ? '我的' : '今日工作'}
          title={
            scene === 'mine'
              ? '个人中心'
              : (data?.contexts || initial.contexts).find((c) => c.id === scene)?.label ||
                '今日工作'
          }
        >
          <div className="field-scope">
            <span data-motion-value="text">{data?.businessDate || initial.businessDate}</span>
            <label>
              <span className="field-sr-only">工作校区</span>
              <select
                value={campus}
                onChange={(e) => {
                  setCampus(e.target.value);
                  setSelected('');
                  setMessage('');
                }}
              >
                {(data?.campuses || initial.campuses).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}校区
                  </option>
                ))}
              </select>
            </label>
          </div>
        </WorkspaceHeader>
        <Notice>{message || result.error}</Notice>
        {data?.directAttendance?.allowed && !data.presence && scene !== 'repair' && (
          <div className="field-actions">
            <button className="field-primary" disabled={busy} onClick={openAttendance}>
              本人到岗签到
            </button>
          </div>
        )}
        <div className="workspace-update" role="status" aria-live="polite">
          {result.loading ? '正在更新当前区域…' : ''}
        </div>
        {!data ? (
          result.error ? (
            <Empty title="暂时无法读取工作台">
              <button onClick={refresh}>重新读取</button>
            </Empty>
          ) : (
            <section className="field-card">
              <h2 data-motion-value="text">{scene === 'mine' ? '个人工作' : '当日工作'}</h2>
              <DataFields
                fields={[
                  ['工作日期', initial.businessDate],
                  ['工作校区', campusName],
                  ['当前岗位'],
                  ['到岗状态'],
                  ['当前工单']
                ]}
              />
              <p className="field-muted">签到、接单与协调操作将在核对当前岗位和任务后显示。</p>
            </section>
          )
        ) : (
          <>
            {!!data.pendingSwapInvitations &&
              workspaceLinks.some((entry) => entry.id === 'roster') && (
                <section className="field-roster-todo" aria-label="待响应的换班邀请">
                  <div>
                    <strong data-motion-value="text">
                      {data.pendingSwapInvitations} 份换班邀请等待你确认
                    </strong>
                  </div>
                  <button onClick={() => onNavigate('roster-requests')}>查看邀请</button>
                </section>
              )}
            {scene === 'repair' && (
              <RepairScene
                active={active}
                key={key}
                scene={scene}
                setSelected={setSelected}
                setScanOpen={setScanOpen}
                setRegistration={setRegistration}
                setMessage={setMessage}
                busy={busy}
                data={data}
                refresh={refresh}
                resolve={resolve}
                openAttendance={openAttendance}
                presence={presence}
                campusName={campusName}
              />
            )}
            {scene === 'desk' && (
              <DeskScene
                key={key}
                setSelected={setSelected}
                setRegistration={setRegistration}
                setScanOpen={setScanOpen}
                busy={busy}
                filter={filter}
                setFilter={setFilter}
                search={search}
                setSearch={setSearch}
                tab={tab}
                setTab={setTab}
                showAvailable={showAvailable}
                setShowAvailable={setShowAvailable}
                peopleQuery={peopleQuery}
                setPeopleQuery={setPeopleQuery}
                result={result}
                data={data}
                showAttendance={showAttendance}
                items={items}
                people={people}
                visiblePeople={visiblePeople}
              />
            )}
            {scene === 'mine' && (
              <PersonalScene
                initial={initial}
                onNavigate={onNavigate}
                workspaceLinks={workspaceLinks}
                onLogout={onLogout}
                key={key}
                busy={busy}
                data={data}
                openAttendance={openAttendance}
                campusName={campusName}
              />
            )}
            <footer className="field-footer">
              <span data-motion-value="text">
                更新于 {time(data.updatedAt)} · 页面可见时每 30 秒更新
              </span>
              <button onClick={refresh}>刷新</button>
            </footer>
          </>
        )}
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
              {campusName}校区 · {data?.businessDate}
            </p>
            <strong data-motion-value="text">{time(checkResult.occurredAt)}</strong>
            <p data-motion-value="text" className="field-muted">
              {checkResult.nonScheduled ? '非排班到场参与工作' : '当天排班已到岗'}
              {checkResult.isExisting ? ' · 保留首次签到时间' : ''}
            </p>
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
          summary={
            items.find((item) => item.id === selected) ||
            (data?.currentRepair?.id === selected
              ? data.currentRepair
              : data?.pendingRepair?.id === selected
                ? data.pendingRepair
                : undefined)
          }
          key={selected}
          memberId={initial.actor.memberId}
          people={people}
          customerCredential={customerCredential?.id === selected ? customerCredential : null}
          onClose={() => {
            setSelected('');
            refresh();
          }}
          onChanged={refresh}
        />
      )}
      {registration && (
        <Registration
          campus={campusName}
          frontdesk={scene !== 'repair'}
          onClose={() => setRegistration(false)}
          onDone={(id, accessToken) => {
            setCustomerCredential(accessToken ? { id, accessToken } : null);
            setRegistration(false);
            setSelected(id);
            refresh();
            setMessage(
              scene === 'repair'
                ? '登记成功，请继续核验接单'
                : '登记成功，请展示维修码交接。关闭详情后可继续登记下一位。'
            );
          }}
        />
      )}
    </>
  );
}
