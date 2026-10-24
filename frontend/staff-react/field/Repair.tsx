import { outcomeLabels } from '../../../shared/constants.js';
import { Modal, Notice, CredentialCard, Status } from './ui';
import type { Person } from './types';
import { RecordMaintenance } from '../RecordMaintenance';
import { RepairAttachments } from '../RepairAttachments';
import { RepairOriginal } from '../RepairOriginal';
import { useRepair } from './useRepair';
import { useState, useEffect, useId } from 'react';
import { CustomerQueueLink } from './CustomerQueueLink';
import { Reception } from './Reception';
import { IntakePhotos } from './IntakePhotos';
import { receptionStatus, queueTicketLabel } from '../../../shared/reception.js';
import { formatInstant } from '../../../shared/time.js';

export function Repair({
  id,
  memberId,
  people,
  onClose,
  onChanged,
  sidePanel = false,
  customerCredential,
  returnLabel = '返回工作台'
}: {
  id: string;
  memberId: string;
  people: Person[];
  onClose: () => void;
  onChanged: () => void;
  sidePanel?: boolean;
  customerCredential?: { id: string; accessToken: string } | null;
  returnLabel?: string;
}) {
  const [direct, setDirect] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const intakeFormId = useId();
  const {
    item,
    error,
    busy,
    verification,
    setVerification,
    note,
    setNote,
    outcome,
    setOutcome,
    confirm,
    setConfirm,
    transfer,
    setTransfer,
    target,
    setTarget,
    reason,
    setReason,
    files,
    setFiles,
    uploaded,
    setUploaded,
    previews,
    receivers,
    receiversLoading,
    load,
    start,
    receptionCommand,
    finish,
    saveNote,
    handoff
  } = useRepair({ id, memberId, people, onClose, onChanged, sidePanel, returnLabel });
  useEffect(
    () => setIdentityConfirmed(false),
    [
      id,
      item?.revision,
      verification.brand,
      verification.model,
      verification.warranty,
      verification.liquidMetal,
      uploaded.front,
      uploaded.back,
      files.front,
      files.back
    ]
  );
  const checkedDevice = item?.canStart || item?.canReceive ? verification : item?.intake;
  const followup = item?.repairHistory?.followups.find(
    (entry) => entry.scheduledAppointmentId === item.id
  );
  const previousRepair = item?.repairHistory?.items.find(
    (entry) => entry.id === followup?.parentAppointmentId
  );
  const round = item?.repairHistory?.items.findIndex((entry) => entry.id === item.id) ?? -1;
  const verifying =
    item &&
    ((item.canReceive && !direct) ||
      (item.canStart && ((!item.canReceive && item.reception?.state !== 'queued') || direct)));
  const stage =
    item?.status === 'completed'
      ? 4
      : item?.status === 'in_progress'
        ? 3
        : item?.reception?.state === 'assigned'
          ? 2
          : item?.reception?.state === 'queued'
            ? 1
            : -1;
  return (
    <Modal
      sidePanel={sidePanel}
      dismissible={!busy}
      title={
        item?.canReceive
          ? '到场接待'
          : item?.canReturn
            ? '确认接手'
            : item?.canDispatch
              ? '现场分派'
              : item?.canStart
                ? '现场核验'
                : item?.canFinish
                  ? '当前维修'
                  : '预约详情'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        verifying && (
          <div className="field-intake-actions">
            {item.reception?.state === 'assigned' && (
              <label className="field-accept-check">
                <input
                  type="checkbox"
                  form={intakeFormId}
                  required
                  checked={identityConfirmed}
                  onChange={(event) => setIdentityConfirmed(event.target.checked)}
                />
                <span>
                  我已当面核对 {queueTicketLabel(item.reception.ticket) || item.id}、机主
                  {item.name ? ' ' + item.name : ''}和 {verification.brand} {verification.model}
                </span>
              </label>
            )}
            <button
              type="submit"
              form={intakeFormId}
              className="field-primary field-wide"
              disabled={
                busy ||
                (item.reception?.state === 'assigned' && !identityConfirmed) ||
                (!!item.canReceive &&
                  ['front', 'back'].some((side) => !files[side] && !uploaded[side]))
              }
            >
              {busy
                ? '正在保存核验信息…'
                : item.canReceive && !direct
                  ? '完成接待，进入现场队列'
                  : item.reception?.state === 'assigned'
                    ? '确认接手，开始维修'
                    : '确认开始维修'}
            </button>
          </div>
        )
      }
    >
      <Notice>{error}</Notice>
      {!item ? (
        <p>正在读取工单…</p>
      ) : (
        <>
          <div className="field-ticket">
            <div>
              <Status value={receptionStatus(item)} />
              {item.registrationFlow === 'repair_followup' && (
                <span className="field-followup-badge">
                  返修{round >= 0 ? ` · 第 ${round + 1} 轮` : ''}
                </span>
              )}
              {item.reception?.ticket && (
                <strong className="field-queue-number">
                  {queueTicketLabel(item.reception.ticket)} · {item.reception.ticket.date}
                </strong>
              )}
              <span className="field-muted">{item.id}</span>
            </div>
            <h3>
              {checkedDevice?.brand || item.brand}{' '}
              {checkedDevice?.model || item.deviceModel || item.deviceType}
            </h3>
            <p>
              {item.faultType} {!followup && item.issue ? `· ${item.issue}` : ''}
            </p>
            <p className="field-muted">
              {item.campus}校区 · {item.date} · {item.timeSlot}
            </p>
            {item.assignedToName && (
              <>
                <p>
                  维修人员：{item.assignedToName} ·{' '}
                  {(item.assigneeIdentities || []).map((identity) => identity.label).join(' / ') ||
                    '当前无有效工作身份'}
                </p>
                {item.assigneeIdentitySnapshot && (
                  <p className="field-muted">
                    接手时：{item.assigneeIdentitySnapshot.name} ·{' '}
                    {item.assigneeIdentitySnapshot.identities
                      .map((identity) => identity.label)
                      .join(' / ') || '已记录'}
                  </p>
                )}
              </>
            )}
            {item.name && (
              <p>
                {item.name} · {item.studentId}
              </p>
            )}
            {(item.contactValue || item.social || item.phone) && (
              <p>
                联系方式：
                {item.contactValue
                  ? `${item.contactType === 'qq' ? 'QQ' : '微信'}：${item.contactValue}`
                  : [item.social, item.phone].filter(Boolean).join(' · ')}
              </p>
            )}
            {item.email && <p>邮箱：{item.email}</p>}
          </div>
          {stage >= 0 && (
            <ol className="repair-stages" aria-label="维修进度">
              {['已到场', '待分派', '待接手', '维修中', '已完成'].map((label, index) => (
                <li key={label} aria-current={stage === index ? 'step' : undefined}>
                  {label}
                </li>
              ))}
            </ol>
          )}
          {followup && (
            <section className="field-followup-context" aria-label="本次返修">
              <h3>本次返修</h3>
              <p>{followup.reason}</p>
              {previousRepair && (
                <details className="field-details" open>
                  <summary>
                    上轮维修 · {outcomeLabels[previousRepair.outcome || ''] || '已完成'}
                  </summary>
                  <p>{previousRepair.repairNote || '暂无维修说明'}</p>
                  <small className="field-state-note">
                    {previousRepair.id} · {previousRepair.date}
                    {previousRepair.assignedToName ? ` · ${previousRepair.assignedToName}` : ''}
                  </small>
                </details>
              )}
            </section>
          )}
          {!item.canReceive && item.startBlockedReason && (
            <small className="field-state-note" role="status">
              {item.reception?.leftAt ? '客户已离队' : '仅可处理队首'}
            </small>
          )}
          <Reception
            item={item}
            businessDate={item.businessDate || item.date}
            onCommand={async (action, extra) => {
              try {
                await receptionCommand(action, extra);
              } catch (failure) {
                await load().catch(() => {});
                onChanged();
                throw failure;
              }
            }}
            busy={busy}
          />
          {item.canStart && (item.canReceive || item.reception?.state === 'queued') && !direct && (
            <button className="field-secondary field-wide" onClick={() => setDirect(true)}>
              直接核验接单
            </button>
          )}
          {verifying && (
            <form
              id={intakeFormId}
              onSubmit={(event) => {
                if (item.reception?.state === 'assigned' && !identityConfirmed) {
                  event.preventDefault();
                  return;
                }
                void start(event, !!item.canReceive && !direct);
              }}
              className="field-form"
            >
              {item.reception && (
                <small className="field-state-note">
                  {item.canReceive ? '重新到场 · 待核验' : '待现场核对'}
                </small>
              )}
              {item.reception && !item.canReceive && (
                <small className="field-state-note">
                  保修：
                  {
                    { in_warranty: '在保', expired: '已过保', unknown: '待确认' }[
                      verification.warranty
                    ]
                  }{' '}
                  · 液金：{{ yes: '是', no: '否', unknown: '待确认' }[verification.liquidMetal]}
                </small>
              )}
              <details open={!item.reception || item.canReceive} className="field-details">
                <summary>
                  {item.reception && !item.canReceive ? '更正核验信息' : '设备核验'}
                </summary>
                <div className="field-form-grid">
                  <label>
                    厂商
                    <input
                      value={verification.brand}
                      required
                      maxLength={80}
                      onChange={(e) =>
                        setVerification({
                          ...verification,
                          brand: e.target.value
                        })
                      }
                    />
                  </label>
                  <label>
                    型号
                    <input
                      value={verification.model}
                      required
                      maxLength={120}
                      onChange={(e) =>
                        setVerification({
                          ...verification,
                          model: e.target.value
                        })
                      }
                    />
                  </label>
                  <label>
                    保修情况
                    <select
                      value={verification.warranty}
                      onChange={(e) =>
                        setVerification({
                          ...verification,
                          warranty: e.target.value
                        })
                      }
                    >
                      <option value="unknown">待确认</option>
                      <option value="in_warranty">在保</option>
                      <option value="expired">已过保</option>
                    </select>
                  </label>
                  <label>
                    液金散热
                    <select
                      value={verification.liquidMetal}
                      onChange={(e) =>
                        setVerification({
                          ...verification,
                          liquidMetal: e.target.value
                        })
                      }
                    >
                      <option value="unknown">待确认</option>
                      <option value="yes">是</option>
                      <option value="no">否</option>
                    </select>
                  </label>
                </div>
                {verification.warranty === 'in_warranty' && (
                  <Notice>在保设备建议优先联系官方售后，避免影响保修。</Notice>
                )}
                <label>
                  核验说明（选填）
                  <textarea
                    maxLength={500}
                    value={verification.note}
                    onChange={(e) => setVerification({ ...verification, note: e.target.value })}
                  />
                </label>
              </details>
              <IntakePhotos
                id={item.id}
                uploaded={uploaded}
                previews={previews}
                busy={busy}
                onFile={(side, file) => {
                  setFiles({ ...files, [side]: file });
                  setUploaded({ ...uploaded, [side]: '' });
                }}
              />
              {item.canReceive &&
                ['front', 'back'].some((side) => !files[side] && !uploaded[side]) && (
                  <small className="field-state-note" role="status">
                    本次照片待补齐
                  </small>
                )}
            </form>
          )}
          {item.canFinish && (
            <form
              className="field-form"
              onSubmit={(e) => {
                e.preventDefault();
                setConfirm(true);
              }}
            >
              <label>
                维修说明
                <textarea
                  rows={5}
                  required
                  maxLength={3000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="记录诊断、处理过程和结果"
                />
              </label>
              <fieldset className="field-results">
                <legend>维修结果</legend>
                {['repaired', 'unrepaired', 'not_needed'].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      required
                      checked={outcome === value}
                      name="outcome"
                      value={value}
                      onChange={() => setOutcome(value)}
                    />
                    {outcomeLabels[value]}
                  </label>
                ))}
              </fieldset>
              <button type="button" disabled={busy} onClick={saveNote}>
                保存维修说明
              </button>
              <button className="field-primary field-wide" disabled={busy}>
                提交维修结果
              </button>
            </form>
          )}
          {item.status === 'completed' && (
            <div className="field-success">
              <h3>维修记录已提交</h3>
              <p>
                {outcomeLabels[item.outcome || ''] || '已完成'} · {item.repairNote}
              </p>
              <button className="field-primary" onClick={onClose}>
                {returnLabel}
              </button>
            </div>
          )}
          {item.canTransfer && !transfer && (
            <button className="field-secondary field-wide" onClick={() => setTransfer(true)}>
              转交其他维修人员
            </button>
          )}
          {transfer && (
            <form className="field-form workspace-handoff" onSubmit={handoff}>
              <h3>选择接手人员</h3>
              <label>
                接手人员
                <select required value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">请选择人员</option>
                  {receivers
                    .filter((p) => p.canReceive)
                    .map((p) => (
                      <option key={p.memberId} value={p.account}>
                        {p.name} ·{' '}
                        {(p.identities || []).map((item) => item.label).join(' / ') ||
                          p.department ||
                          '维修人员'}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                交接原因
                <textarea
                  required
                  minLength={2}
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>
                {item.assignedToName} →{' '}
                {receivers.find((p) => p.account === target)?.name || '待选择'}
              </p>
              {!receiversLoading && !receivers.length && (
                <Notice>当前没有可接手人员，请安排人员到岗后重新打开转交。</Notice>
              )}
              <button
                className="field-primary"
                disabled={
                  busy ||
                  receiversLoading ||
                  !receivers.some((person) => person.account === target && person.canReceive)
                }
              >
                确认转交
              </button>
            </form>
          )}
          {item.status === 'booked' && !item.canStart && item.repairCode && (
            <CredentialCard
              kind="repair"
              code={item.repairCode}
              context={`${item.campus}校区 · ${item.id}`}
              detail={`${item.brand} ${item.deviceModel}`}
            />
          )}
          {customerCredential?.id === item.id && <CustomerQueueLink {...customerCredential} />}
          {item.intake && !item.canStart && (
            <details className="field-details">
              <summary>现场核验信息</summary>
              <p>
                {item.intake.brand} {item.intake.model}
              </p>
              <p>
                保修：
                {
                  { in_warranty: '在保', expired: '已过保', unknown: '待确认' }[
                    item.intake.warranty
                  ]
                }{' '}
                · 液金：
                {{ yes: '是', no: '否', unknown: '待确认' }[item.intake.liquidMetal]}
              </p>
              <p>{item.intake.note}</p>
            </details>
          )}
          {item.canReadDetails && <RepairAttachments id={item.id} revision={item.revision} />}
          {!!item.receptionHistory?.length && (
            <details className="field-details">
              <summary>接待与维修流转记录</summary>
              <ol className="reception-history">
                {item.receptionHistory.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {{
                        'receptions.received': '完成接待',
                        'receptions.assign': '分派待接手',
                        'receptions.return': '退回现场队列',
                        'receptions.withdraw': '撤回分派',
                        'receptions.cancel': '取消预约',
                        'receptions.leave': '客户离队',
                        'receptions.guest_leave': '客户主动退出排队',
                        'receptions.reschedule': '改约',
                        'repairs.claimed': '确认开始维修',
                        'repairs.started': '确认开始维修',
                        'repairs.transferred': '转派维修',
                        'repairs.completed': '完成维修'
                      }[event.action] || '工单已更新'}
                    </strong>
                    <span>
                      {event.actorName}
                      {event.ticketNumber ? ` · ${event.ticketNumber}号` : ''}
                      {event.assigneeName ? ` → ${event.assigneeName}` : ''} ·{' '}
                      {formatInstant(event.occurredAt)}
                    </span>
                    {event.reason && <p>{event.reason}</p>}
                    {event.action === 'receptions.reschedule' && (
                      <p>
                        {formatInstant(event.date).split(' ')[0]} · {event.timeSlot}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
          <RepairOriginal
            original={
              item.canReadDetails
                ? {
                    ...item.original,
                    brand: item.brand,
                    deviceModel: item.deviceModel,
                    warranty: item.warranty,
                    liquidMetal: item.liquidMetal,
                    dellG15: item.dellG15,
                    issue: item.issue
                  }
                : item.original
            }
          />
          <RecordMaintenance
            item={item}
            busy={busy}
            onChanged={async () => {
              await load();
              onChanged();
            }}
          />
        </>
      )}
      {confirm && (
        <div className="field-confirm" role="region" aria-label="确认维修结果">
          <h3>确认提交本次维修结果？</h3>
          <p>{outcomeLabels[outcome]}</p>
          <p>{note}</p>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              返回修改
            </button>
            <button disabled={busy} className="field-primary" onClick={finish}>
              {busy ? '正在提交…' : '确认提交'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
