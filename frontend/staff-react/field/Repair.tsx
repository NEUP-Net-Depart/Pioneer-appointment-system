import { outcomeLabels } from '../../../shared/constants.js';
import { Modal, Notice, CredentialCard, Status } from './ui';
import type { Person } from './types';
import { RecordMaintenance } from '../RecordMaintenance';
import { RepairAttachments } from '../RepairAttachments';
import { RepairOriginal } from '../RepairOriginal';
import { useRepair } from './useRepair';

export function Repair({
  id,
  memberId,
  people,
  onClose,
  onChanged,
  sidePanel = false,
  returnLabel = '返回工作台'
}: {
  id: string;
  memberId: string;
  people: Person[];
  onClose: () => void;
  onChanged: () => void;
  sidePanel?: boolean;
  returnLabel?: string;
}) {
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
    finish,
    saveNote,
    handoff
  } = useRepair({ id, memberId, people, onClose, onChanged, sidePanel, returnLabel });
  return (
    <Modal
      sidePanel={sidePanel}
      title={item?.canStart ? '现场核验' : item?.canFinish ? '当前维修' : '预约详情'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Notice>{error}</Notice>
      {!item ? (
        <p>正在读取工单…</p>
      ) : (
        <>
          <div className="field-ticket">
            <div>
              <Status value={item.status} />
              <span className="field-muted">{item.id}</span>
            </div>
            <h3>
              {item.brand} {item.deviceModel || item.deviceType}
            </h3>
            <p>
              {item.faultType} {item.issue ? `· ${item.issue}` : ''}
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
            {item.liquidMetal && (
              <p className="field-muted">
                客户填写液金情况：{item.liquidMetal}
                {item.dellG15 ? ` · Dell G15：${item.dellG15}` : ''}；请现场核实。
              </p>
            )}
          </div>
          {item.canStart && (
            <form onSubmit={start} className="field-form">
              <h3>与机主确认设备信息</h3>
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
              <div className="field-photos">
                {['front', 'back'].map((side) => (
                  <label key={side}>
                    {previews[side] ? (
                      <img src={previews[side]} alt="设备照片预览" />
                    ) : (
                      <span>{uploaded[side] ? '已上传' : '＋'}</span>
                    )}
                    <strong>设备{side === 'front' ? '正面' : '背面'}</strong>
                    <small>拍照或选择照片 · 最大 5 MB</small>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      aria-label={`设备${side === 'front' ? '正面' : '背面'}照片`}
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          setFiles({ ...files, [side]: e.target.files[0] });
                          setUploaded({ ...uploaded, [side]: '' });
                        }
                      }}
                    />
                  </label>
                ))}
              </div>
              <button className="field-primary field-wide" disabled={busy}>
                {busy ? '正在保存核验信息…' : '确认开始维修'}
              </button>
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
              <p className="field-muted">填写内容会保留在当前登录会话中</p>
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
              <p className="field-muted">仅可选择已签到、空闲且具备本校区维修资格的人员。</p>
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
          <RepairOriginal original={item.original} />
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
