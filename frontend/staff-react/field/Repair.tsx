import { useState } from 'react';
import { outcomeLabels, repairOutcomes } from '../../../shared/constants.js';
import { Modal, Notice, Status } from './ui';
import { RepairInformation, RepairCredential, RepairHistory } from '../RepairDetails';
import { RepairRelations } from '../RepairRelations';
import { WarrantyLookupButton } from './WarrantyLookup';
import { RepairOriginal } from '../RepairOriginal';
import { RepairAttachments } from '../RepairAttachments';
import { IntakePhotos } from './IntakePhotos';
import { useRepair } from './useRepair';
import { formatInstant } from '../../../shared/time.js';

function RepairOrder({
  id,
  onOpen,
  onClose,
  onChanged,
  sidePanel = false,
  hideWarrantyLookup = false,
  customerCredential
}: {
  id: string;
  onOpen: (id: string, token?: string) => void;
  onClose: () => void;
  onChanged: () => void;
  sidePanel?: boolean;
  hideWarrantyLookup?: boolean;
  customerCredential?: { id: string; accessToken: string } | null;
}) {
  const r = useRepair({ id, onChanged });
  const { item, busy } = r;
  const [received, setReceived] = useState(false);
  return (
    <Modal title="维修工单" sidePanel={sidePanel} dismissible={!busy} onClose={onClose}>
      <Notice>{r.error}</Notice>
      {!item ? (
        <p>正在读取工单…</p>
      ) : (
        <>
          <section className="field-ticket">
            <Status value={item.status} />
            <p>
              {item.id} · {item.campus} · {item.date} {item.timeSlot}
            </p>
            <h3>
              {item.brand} {item.deviceModel || item.deviceType}
            </h3>
            <p>
              {item.name} · {item.studentId}
            </p>
            <p>
              {item.faultType} {item.issue}
            </p>
            <p>
              联系方式：{item.contactValue || item.social || item.phone || '未记录'} {item.email}
            </p>
            <p>当前主修：{item.assignedToName || '尚未接单'}</p>
            {item.receivedAt && <p>首次接收：{formatInstant(item.receivedAt)}</p>}
            {item.photoDeferredBy && <Notice>首次接收照片待传，由经办人手动补传原图。</Notice>}
          </section>
          {item.canStart && (
            <section className="field-form">
              {!item.receivedAt && (
                <>
                  <details className="field-details">
                    <summary>修正设备资料</summary>
                    <label>
                      品牌
                      <input
                        maxLength={80}
                        value={r.verification.brand}
                        onChange={(e) =>
                          r.setVerification({ ...r.verification, brand: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      型号（未知可留空）
                      <input
                        maxLength={120}
                        value={r.verification.model}
                        onChange={(e) =>
                          r.setVerification({ ...r.verification, model: e.target.value })
                        }
                      />
                    </label>
                  </details>
                  <p>首次接收请拍摄正、反面照片。请在手机或本地保留原图。</p>
                  <IntakePhotos
                    id={id}
                    uploaded={r.uploaded}
                    previews={r.previews}
                    busy={busy}
                    onFile={r.onFile}
                  />
                </>
              )}
              <button className="field-primary" disabled={busy} onClick={() => r.start()}>
                直接接单，开始维修
              </button>
              {item.canReceive && (
                <button disabled={busy} onClick={() => r.start(true)}>
                  仅记录接收
                </button>
              )}
              {r.timedOut && (
                <button disabled={busy} onClick={() => r.start(false, true)}>
                  稍后补传，继续接单
                </button>
              )}
            </section>
          )}
          {item.canSupplement && (
            <section className="field-form">
              <h3>待传照片</h3>
              <p>请选择首次接收时保存的原图；请勿以维修后的补拍替代。</p>
              <IntakePhotos
                id={id}
                uploaded={r.uploaded}
                previews={r.previews}
                busy={busy}
                onFile={r.onFile}
              />
              <button disabled={busy} onClick={r.supplement}>
                手动补传原图
              </button>
            </section>
          )}
          {item.canTransfer && (
            <section className="field-form">
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={received}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                我已实际接到设备，确认成为当前主修
              </label>
              <button disabled={busy || !received} onClick={r.handoff}>
                确认接手
              </button>
            </section>
          )}
          {(item.canFinish || item.canCorrect) && (
            <form
              className="field-form"
              onSubmit={(e) => {
                e.preventDefault();
                void (item.canFinish ? r.finish() : r.correct());
              }}
            >
              <fieldset>
                <legend>本次处理结果</legend>
                {repairOutcomes.map((value) => (
                  <label className="field-check" key={value}>
                    <input
                      type="radio"
                      name="outcome"
                      required
                      checked={r.outcome === value}
                      onChange={() => r.setOutcome(value)}
                    />
                    {outcomeLabels[value]}
                  </label>
                ))}
              </fieldset>
              <label>
                简短处理说明
                <textarea
                  required
                  maxLength={1000}
                  value={r.note}
                  onChange={(e) => r.setNote(e.target.value)}
                  placeholder="说明处理结果；部分解决或未解决时写清剩余问题"
                />
              </label>
              <button className="field-primary" disabled={busy}>
                {item.canFinish ? '结束本次服务' : '保存结果更正'}
              </button>
            </form>
          )}
          {item.status === 'completed' && (
            <p>
              {outcomeLabels[item.outcome || ''] || '历史未分类'} · {item.repairNote}
            </p>
          )}
          {!hideWarrantyLookup && <WarrantyLookupButton initialBrand={item.brand} />}
          <RepairRelations
            key={id}
            item={item}
            onChanged={() => {
              void r.load();
              onChanged();
            }}
            onOpen={onOpen}
          />
          <RepairAttachments id={id} revision={item.revision} />
          <RepairInformation
            item={item}
            onChanged={() => {
              void r.load();
              onChanged();
            }}
          />
          <RepairCredential item={item} onIssued={(token) => onOpen(id, token)} />
          <RepairHistory history={item.repairHistory} />
          <RepairOriginal original={item.original} />
          {customerCredential && (
            <a
              href={`/#${new URLSearchParams({ appointment: customerCredential.id, access: customerCredential.accessToken })}`}
              target="_blank"
              rel="noreferrer"
            >
              客户私人查询链接
            </a>
          )}
        </>
      )}
    </Modal>
  );
}

export function Repair(props: Omit<Parameters<typeof RepairOrder>[0], 'onOpen'>) {
  const [id, setId] = useState(props.id);
  const [credential, setCredential] = useState(props.customerCredential);
  return (
    <RepairOrder
      {...props}
      key={id}
      id={id}
      customerCredential={credential}
      onOpen={(nextId, token) => {
        setId(nextId);
        setCredential(token ? { id: nextId, accessToken: token } : null);
      }}
    />
  );
}
