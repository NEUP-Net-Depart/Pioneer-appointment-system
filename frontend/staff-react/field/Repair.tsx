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
import { DataValue } from '../DataValue';

function RepairOrder({
  id,
  onOpen,
  onClose,
  sidePanel = false,
  hideWarrantyLookup = false,
  customerCredential
}: {
  id: string;
  onOpen: (id: string, token?: string) => void;
  onClose: () => void;
  sidePanel?: boolean;
  hideWarrantyLookup?: boolean;
  customerCredential?: { id: string; accessToken: string } | null;
}) {
  const r = useRepair({ id });
  const { item, busy } = r;
  const [received, setReceived] = useState(false);
  return (
    <Modal
      title="维修工单"
      className="repair-order-dialog"
      sidePanel={sidePanel}
      dismissible={!busy}
      onClose={onClose}
    >
      <Notice>{r.error}</Notice>
      <section className="field-ticket" aria-busy={!item}>
        {item ? (
          <Status value={item.status} />
        ) : (
          <span className="field-status">
            <DataValue label="工单状态" digits={4} />
          </span>
        )}
        <p>
          {id} ·{' '}
          <DataValue label="预约时间和校区">
            {item ? `${item.campus} · ${item.date} ${item.timeSlot}` : undefined}
          </DataValue>
        </p>
        <h3>
          <DataValue label="设备信息">
            {item ? `${item.brand} ${item.deviceModel || item.deviceType}` : undefined}
          </DataValue>
        </h3>
        <p>
          <DataValue label="预约人员">
            {item ? [item.name, item.studentId].filter(Boolean).join(' · ') : undefined}
          </DataValue>
        </p>
        <p>
          <DataValue label="故障信息">
            {item ? [item.faultType, item.issue].filter(Boolean).join(' ') : undefined}
          </DataValue>
        </p>
        <p>
          联系方式：
          <DataValue label="联系方式">
            {item
              ? [item.contactValue || item.social || item.phone || '未记录', item.email]
                  .filter(Boolean)
                  .join(' ')
              : undefined}
          </DataValue>
        </p>
        <p>
          当前主修：
          <DataValue label="当前主修">
            {item ? item.assignedToName || '尚未开始维修' : undefined}
          </DataValue>
        </p>
        {item?.receivedAt && (
          <p>
            首次接收：{item.receivedByName || item.receivedBy} · {formatInstant(item.receivedAt)}
          </p>
        )}
        {item?.receivedAt && item.status === 'booked' && <p>设备已接收，等待维修人员确认接手。</p>}
        {item?.photoDeferredBy && <Notice>首次接收照片待传，由经办人手动补传原图。</Notice>}
      </section>
      {item && (
        <>
          {(item.canStart || item.canReceive) && (
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
              <div className="field-actions repair-intake-actions">
                {item.canStart && (
                  <button className="field-primary" disabled={busy} onClick={() => r.start()}>
                    {item.receivedAt ? '确认接手并开始维修' : '接收并开始维修'}
                  </button>
                )}
                {item.canReceive && (
                  <button
                    className={!item.canStart ? 'field-primary' : undefined}
                    disabled={busy}
                    onClick={() => r.start(true)}
                  >
                    仅接收设备
                  </button>
                )}
                {r.timedOut && item.canReceive && (
                  <button disabled={busy} onClick={() => r.start(true, true)}>
                    稍后补传，仅接收设备
                  </button>
                )}
                {r.timedOut && item.canStart && (
                  <button disabled={busy} onClick={() => r.start(false, true)}>
                    稍后补传，接收并开始维修
                  </button>
                )}
              </div>
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
              <fieldset className="field-results">
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
          {!hideWarrantyLookup && (item.canStart || item.canTransfer || item.canFinish) && (
            <WarrantyLookupButton initialBrand={item.brand} />
          )}
          <RepairRelations
            key={id}
            item={item}
            onChanged={() => {
              void r.load();
            }}
            onOpen={onOpen}
          />
          <RepairAttachments id={id} />
          {item.canEdit && (
            <RepairInformation
              item={item}
              onChanged={() => {
                void r.load();
              }}
            />
          )}
          <RepairCredential item={item} onIssued={(token) => onOpen(id, token)} />
          {(item.repairHistory || item.original) && (
            <section className="repair-management">
              <h3>管理记录</h3>
              <div className="field-actions">
                <RepairHistory history={item.repairHistory} />
                <RepairOriginal original={item.original} />
              </div>
            </section>
          )}
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
