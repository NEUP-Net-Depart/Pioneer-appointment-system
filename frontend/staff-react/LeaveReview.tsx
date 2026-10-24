import { DataFields } from './DataValue';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceSections } from './WorkspaceSections';
import { useWorkspaceQuery } from './useWorkspaceQuery.js';
import { request } from './request.js';
import { requestStatusLabel } from '../../shared/staff-request-status.js';
import { staffPermission } from '../../shared/staff-access.js';
import './leave-review.css';
import { StaffIdentity } from './StaffIdentity';

type Leave = {
  id: string;
  memberName: string;
  memberId: string;
  identities?: { code: string; label: string }[];
  reason: string;
  status: string;
  revision: number;
  reviewNote: string;
  createdAt: string;
  departments: string[];
  assignment: {
    campusId: string;
    campusName: string;
    businessDate: string;
    startAt: string;
    endAt: string;
    dutyType: string;
  };
  actions: { review: boolean; approve: boolean; reason: string };
  impact?: {
    scheduled: number;
    expected: number;
    afterApproval: number;
    leaders: number;
    leadersAfterApproval: number;
    ordinaryAfterApproval?: number;
    ordinaryMinimum?: number;
    checkedIn: boolean;
    arrived: number;
    needsReplacement: boolean;
  };
};
export function LeaveReview({
  user,
  onNavigate
}: {
  user: object;
  onNavigate: (view: string) => void;
}) {
  const active = useContext(ActivityContext);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 650px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 650px)');
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [status, setStatus] = useState('pending'),
    [query, setQuery] = useState(''),
    [campus, setCampus] = useState('');
  const [selected, setSelected] = useState(''),
    [note, setNote] = useState(''),
    [decision, setDecision] = useState('');
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  const list = useWorkspaceQuery(
    `/api/leaves?all=true${status ? `&status=${status}` : ''}`,
    active,
    revision
  );
  const detail = useWorkspaceQuery(
    selected ? `/api/leaves/${encodeURIComponent(selected)}` : '',
    active && !!selected,
    revision
  );
  const all: Leave[] = list.data?.items || [];
  const items = all.filter(
    (item) =>
      (!campus || item.assignment?.campusId === campus) &&
      (!query.trim() ||
        `${item.memberName} ${item.reason} ${item.departments.join(' ')}`.includes(query.trim()))
  );
  const campusOptions = [
    ...new Map(
      all
        .filter((item) => item.assignment)
        .map((item) => [item.assignment.campusId, item.assignment.campusName])
    ).entries()
  ];
  const current: Leave | undefined = detail.current ? detail.data : undefined;
  const canArrange =
    current &&
    staffPermission(
      user,
      current.assignment?.dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage'
    );
  function choose(id: string) {
    if (busy) return;
    setSelected(id);
    setNote('');
    setError('');
    setDecision('');
  }
  async function submit() {
    if (lock.current || !current || !decision) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request(`/api/leaves/${encodeURIComponent(current.id)}/decision`, {
        method: 'POST',
        body: { decision, revision: current.revision, note, requestId: crypto.randomUUID() }
      });
      setDecision('');
      setNote('');
      setNotice(
        decision === 'approve'
          ? '请假已批准。原班次保留，人员覆盖已更新。'
          : '申请已退回，说明已保存。'
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      setError((failure as Error).message);
      setDecision('');
      setRevision((value) => value + 1);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const detailContent = (
    <>
      {!selected ? (
        <div className="empty-state">
          <strong>选择一份申请</strong>
          <span>在这里查看签到事实、批准后的覆盖与申请原因。</span>
        </div>
      ) : (
        <>
          {detail.error && (
            <p role="alert" className="react-error">
              {detail.error}
            </p>
          )}
          {!current && (
            <>
              <h2>{all.find((item) => item.id === selected)?.memberName || '成员'}的请假申请</h2>
              <DataFields
                pending={!detail.error}
                fields={[
                  ['班次', all.find((item) => item.id === selected)?.assignment?.businessDate],
                  ['岗位与校区', all.find((item) => item.id === selected)?.assignment?.campusName],
                  ['申请原因', all.find((item) => item.id === selected)?.reason],
                  ['实际签到'],
                  ['批准后人员覆盖']
                ]}
              />
              <p className="field-muted">审批前需核对实际签到和人员覆盖，批准后保留到岗记录。</p>
            </>
          )}
          {current && (
            <>
              <header className="leave-row-title">
                <h2>{current.memberName}的请假申请</h2>
                <span className="account-state" data-state={current.status}>
                  {requestStatusLabel(current.status)}
                </span>
              </header>
              <StaffIdentity identities={current.identities} />
              <dl className="leave-facts">
                <div>
                  <dt>班次</dt>
                  <dd>
                    {current.assignment?.businessDate} · {current.assignment?.startAt}–
                    {current.assignment?.endAt}
                  </dd>
                </div>
                <div>
                  <dt>岗位与校区</dt>
                  <dd>
                    {current.assignment?.dutyType === 'office' ? '办公接待' : '维修值班'} ·{' '}
                    {current.assignment?.campusName}
                  </dd>
                </div>
                <div>
                  <dt>所属部门</dt>
                  <dd>{current.departments.join('、') || '未登记部门'}</dd>
                </div>
                <div>
                  <dt>实际签到</dt>
                  <dd>
                    {current.impact?.checkedIn
                      ? '已签到，请假不会删除实际到岗记录'
                      : '尚无本日该校区签到记录'}
                  </dd>
                </div>
              </dl>
              <section className="leave-detail-section">
                <h3>申请原因</h3>
                <p>{current.reason}</p>
              </section>
              {current.impact && (
                <section className="leave-detail-section">
                  <h3>{current.status === 'pending' ? '批准后人员覆盖' : '当前人员覆盖'}</h3>
                  <div className="leave-coverage">
                    <div>
                      <span>预计出勤</span>
                      <strong>
                        {current.impact.expected}
                        <small> 人</small>
                      </strong>
                    </div>
                    <div>
                      <span>{current.status === 'pending' ? '批准后' : '实际签到'}</span>
                      <strong>
                        {current.status === 'pending'
                          ? current.impact.afterApproval
                          : current.impact.arrived}
                        <small> 人</small>
                      </strong>
                    </div>
                    {current.assignment?.dutyType === 'repair' && (
                      <div>
                        <span>{current.status === 'pending' ? '批准后负责人' : '预计负责人'}</span>
                        <strong>
                          {current.status === 'pending'
                            ? current.impact.leadersAfterApproval
                            : current.impact.leaders}
                          <small> 人</small>
                        </strong>
                      </div>
                    )}
                  </div>
                  <p className="field-muted">
                    原排班 {current.impact.scheduled} 人 · 实际签到 {current.impact.arrived}{' '}
                    人。签到与请假分别记录。
                  </p>
                  {current.impact.ordinaryMinimum != null && (
                    <p className="field-muted">
                      批准后普通人员 {current.impact.ordinaryAfterApproval} 人 / 至少{' '}
                      {current.impact.ordinaryMinimum} 人，负责人单独计算。
                    </p>
                  )}
                  {current.status === 'pending' && current.impact.needsReplacement && (
                    <div className="leave-coverage-warning">
                      <strong>
                        {current.impact.afterApproval === 0
                          ? '批准后该班次将无人值班'
                          : current.impact.leadersAfterApproval === 0
                            ? '批准后缺少维修负责人'
                            : '批准后普通人员低于最低需求'}
                      </strong>
                      <p>可以批准真实请假，同时需要安排补位。</p>
                      {canArrange ? (
                        <button
                          onClick={() =>
                            onNavigate(
                              current.assignment.dutyType === 'office'
                                ? 'office-roster'
                                : 'roster-manage'
                            )
                          }
                        >
                          前往排班补位
                        </button>
                      ) : (
                        <p>请联系有排班权限的负责人协调补位。</p>
                      )}
                    </div>
                  )}
                </section>
              )}
              {current.reviewNote && (
                <section className="leave-detail-section">
                  <h3>审批说明</h3>
                  <p>{current.reviewNote}</p>
                </section>
              )}
              {error && (
                <p role="alert" className="react-error">
                  {error}
                </p>
              )}
              {current.actions.review && (
                <section className="leave-detail-section review-decision">
                  <label>
                    审批说明
                    <textarea
                      maxLength={500}
                      rows={3}
                      value={note}
                      disabled={busy}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="可填写补位安排或退回原因"
                    />
                  </label>
                  {current.actions.reason && (
                    <p className="field-muted">{current.actions.reason}</p>
                  )}
                  <div className="field-actions">
                    <button disabled={busy || detail.loading} onClick={() => setDecision('reject')}>
                      退回申请
                    </button>
                    <button
                      className="field-primary"
                      disabled={busy || detail.loading || !current.actions.approve}
                      onClick={() => setDecision('approve')}
                    >
                      批准请假
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
  return (
    <section className="workspace-module">
      <section className="react-page leave-review">
        <WorkspaceHeader group="值班管理" title="请假审批">
          <button disabled={list.loading || busy} onClick={() => setRevision((value) => value + 1)}>
            刷新申请
          </button>
        </WorkspaceHeader>
        {notice && (
          <p role="status" className="react-message">
            {notice}
          </p>
        )}
        <WorkspaceSections
          label="请假申请状态"
          value={status}
          onChange={(value) => {
            if (!busy) {
              setStatus(value);
              setSelected('');
            }
          }}
          items={[
            { id: 'pending', label: '待审批' },
            { id: 'approved', label: '已批准' },
            { id: 'rejected', label: '已退回' },
            { id: '', label: '全部' }
          ]}
        />
        <div className="workspace-list-tools">
          <label>
            查找申请
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="姓名、部门或申请原因"
            />
          </label>
          <label>
            校区
            <select value={campus} onChange={(event) => setCampus(event.target.value)}>
              <option value="">全部授权校区</option>
              {campusOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span aria-live="polite">
            {items.length} 份申请{list.loading ? ' · 更新中' : ''}
          </span>
        </div>
        {list.error && (
          <p role="alert" className="react-error">
            {list.error}
          </p>
        )}
        <div className="leave-workspace">
          <section className="leave-list" aria-label="请假申请列表">
            {items.map((item) => (
              <button
                className="leave-request-card"
                disabled={busy}
                aria-pressed={selected === item.id}
                key={item.id}
                onClick={() => choose(item.id)}
              >
                <div className="leave-row-title">
                  <strong>{item.memberName || '成员'}</strong>
                  <span className="account-state" data-state={item.status}>
                    {requestStatusLabel(item.status)}
                  </span>
                </div>
                <p>
                  {item.assignment?.businessDate} · {item.assignment?.startAt}–
                  {item.assignment?.endAt}
                </p>
                <small>
                  {item.assignment?.campusName} · {item.departments.join('、') || '成员所属部门'}
                </small>
                <p className="leave-reason">{item.reason}</p>
              </button>
            ))}
            {!items.length && list.loading && !list.data && (
              <DataFields fields={[['申请人'], ['班次'], ['申请原因']]} />
            )}
            {!items.length && !list.loading && !list.error && (
              <div className="react-card empty-state">
                <strong>当前没有符合条件的申请</strong>
                <span>仅显示你有权审批的校区和部门。</span>
              </div>
            )}
          </section>
          {narrow ? (
            selected && (
              <Modal
                title="请假申请"
                dismissible={!busy}
                onClose={() => {
                  if (!busy) setSelected('');
                }}
              >
                <div className="leave-detail-content">{detailContent}</div>
              </Modal>
            )
          ) : (
            <aside className="react-card leave-detail" aria-label="请假申请详情">
              {detailContent}
            </aside>
          )}
        </div>
        {decision && current && (
          <Modal
            title={decision === 'approve' ? '确认批准请假' : '确认退回申请'}
            dismissible={!busy}
            onClose={() => {
              if (!busy) setDecision('');
            }}
          >
            <p>
              {current.memberName} · {current.assignment.businessDate} ·{' '}
              {current.assignment.campusName}
            </p>
            <p>
              {decision === 'approve'
                ? `批准后预计 ${current.impact?.afterApproval ?? 0} 人出勤${current.impact?.needsReplacement ? '，需要安排补位' : ''}。原班次和签到事实会保留。`
                : '申请人将看到退回结果及审批说明。'}
            </p>
            {note && <p className="leave-reason">{note}</p>}
            <div className="field-actions">
              <button disabled={busy} onClick={() => setDecision('')}>
                返回核对
              </button>
              <button className="field-primary" disabled={busy} onClick={submit}>
                {busy ? '正在保存…' : '确认操作'}
              </button>
            </div>
          </Modal>
        )}
      </section>
    </section>
  );
}
