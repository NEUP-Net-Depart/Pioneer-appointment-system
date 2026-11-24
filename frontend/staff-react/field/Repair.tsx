import { useCallback, useState } from 'react';
import { outcomeLabels, repairOutcomes } from '../../../shared/constants.ts';
import { Modal, Notice, Status } from './ui';
import { RepairInformation, RepairHistory } from '../RepairDetails';
import { RepairRelations } from '../RepairRelations';
import { WarrantyLookupButton } from './WarrantyLookup';
import { RepairOriginal } from '../RepairOriginal';
import { RepairAttachments } from '../RepairAttachments';
import { IntakePhotos } from './IntakePhotos';
import { useRepair } from './useRepair';
import { formatInstant } from '../../../shared/time.ts';
import { DataValue } from '../DataValue';
import { warrantyServiceCenterUrl } from '../../../shared/warranty.ts';
import { RepairToolsProvider, useRepairTools } from '../RepairTools';

function RepairOrder({
  id,
  onOpen,
  onClose,
  sidePanel = false,
  hideWarrantyLookup = false
}: {
  id: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  sidePanel?: boolean;
  hideWarrantyLookup?: boolean;
}) {
  const r = useRepair({ id });
  const tools = useRepairTools();
  const { item, busy } = r;
  const [received, setReceived] = useState(false);
  const [photoChecks, setPhotoChecks] = useState<Record<string, boolean>>({});
  const onPhotoChecking = useCallback((side: string, checking: boolean) => {
    setPhotoChecks((current) => ({ ...current, [side]: checking }));
  }, []);
  const checkingPhotos = Object.values(photoChecks).some(Boolean);
  const activeBrand = item ? (!item.receivedAt && r.verification.brand.trim()) || item.brand : '';
  const serviceCenterUrl = warrantyServiceCenterUrl(activeBrand);
  return (
    <Modal
      title="维修工单"
      className="repair-order-dialog"
      sidePanel={sidePanel}
      dismissible={!busy}
      onClose={() => tools?.request(null, onClose)}
    >
      <Notice>{r.error}</Notice>
      <section className="field-ticket repair-summary" aria-busy={!item}>
        <div className="repair-summary-heading">
          <h3>
            <DataValue label="设备信息">
              {item ? `${item.brand} ${item.deviceModel || item.deviceType}` : undefined}
            </DataValue>
          </h3>
          {item ? (
            <Status value={item.status} outcome={item.outcome} />
          ) : (
            <span className="field-status">
              <DataValue label="工单状态" digits={4} />
            </span>
          )}
        </div>
        <p className="repair-summary-customer">
          <DataValue label="预约人员">
            {item ? [item.name, item.studentId].filter(Boolean).join(' · ') : undefined}
          </DataValue>
        </p>
        <dl className="repair-summary-fields">
          <dt>故障</dt>
          <dd>
            <DataValue label="故障信息">
              {item ? [item.faultType, item.issue].filter(Boolean).join(' ') : undefined}
            </DataValue>
          </dd>
          <dt>联系</dt>
          <dd>
            <DataValue label="联系方式">
              {item
                ? [item.contactValue || item.social || item.phone || '未记录', item.email]
                    .filter(Boolean)
                    .join(' ')
                : undefined}
            </DataValue>
          </dd>
          {(item?.assignedToName || item?.receivedAt) && (
            <>
              <dt>主修</dt>
              <dd>
                <DataValue label="当前主修">
                  {item ? item.assignedToName || '尚未开始维修' : undefined}
                </DataValue>
              </dd>
            </>
          )}
        </dl>
        <p className="repair-summary-meta">
          <DataValue label="预约时间和校区">
            {item ? `${item.campus} · ${item.date} ${item.timeSlot}` : undefined}
          </DataValue>
          <span>{id}</span>
        </p>
        {item?.receivedAt && (
          <p>
            首次接收：{item.receivedByName || item.receivedBy} · {formatInstant(item.receivedAt)}
          </p>
        )}
        {item?.receivedAt && item.status === 'booked' && <p>设备已接收，等待维修人员确认接手。</p>}
        {r.photoBusy && <Notice>照片正在上传并保存，请保持此页面打开。</Notice>}
        {item?.photoDeferredBy && !r.photoBusy && (
          <Notice>首次接收照片待传，由经办人补传原图。</Notice>
        )}
      </section>
      {item && (
        <>
          {r.waitingForPhotos && r.canSkip && (
            <div className="field-form">
              <p>
                {r.error
                  ? '照片上传失败，可以跳过并稍后重试补传。仍在上传的照片会继续，成功后自动补入本工单。'
                  : '已等待 30 秒。可以跳过等待，上传会继续，成功后自动补入本工单。'}
              </p>
              <div className="field-actions">
                <button data-track="staff.field.repair.skip-upload" onClick={r.skip}>
                  跳过等待，继续当前操作
                </button>
              </div>
            </div>
          )}
          {(item.canStart || item.canReceive) && (
            <section
              className={`field-form repair-intake${item.receivedAt ? ' repair-intake-ready' : ''}`}
              aria-label="设备接收"
            >
              {!item.receivedAt && (
                <div className="repair-intake-heading">
                  <h3>设备照片</h3>
                  <span className="repair-intake-count" role="status">
                    已准备{' '}
                    {['front', 'back'].filter((side) => r.files[side] || r.uploaded[side]).length} /
                    2 张
                  </span>
                </div>
              )}
              {!item.receivedAt && (
                <IntakePhotos
                  id={id}
                  uploaded={r.uploaded}
                  previews={r.previews}
                  busy={busy || r.photoBusy}
                  progress={r.photoProgress}
                  onChecking={onPhotoChecking}
                  onFile={r.onFile}
                />
              )}
              <div className="field-actions repair-intake-actions">
                {item.canStart && (
                  <button
                    data-track="staff.field.repair.button.5"
                    className="field-primary"
                    disabled={busy || checkingPhotos}
                    onClick={() => r.start()}
                  >
                    {busy ? '正在处理…' : item.receivedAt ? '开始维修' : '接收并开始维修'}
                  </button>
                )}
                {item.canReceive && (
                  <button
                    data-track="staff.field.repair.button.6"
                    className={!item.canStart ? 'field-primary' : undefined}
                    disabled={busy || checkingPhotos}
                    onClick={() => r.start(true)}
                  >
                    仅接收设备
                  </button>
                )}
                {!busy && r.canSkip && item.canReceive && (
                  <button
                    data-track="staff.field.repair.button.7"
                    disabled={busy || checkingPhotos}
                    onClick={() => r.start(true, true)}
                  >
                    跳过等待，仅接收设备
                  </button>
                )}
                {!busy && r.canSkip && item.canStart && (
                  <button
                    data-track="staff.field.repair.button.8"
                    disabled={busy || checkingPhotos}
                    onClick={() => r.start(false, true)}
                  >
                    跳过等待，接收并开始维修
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
                busy={busy || r.photoBusy}
                progress={r.photoProgress}
                onChecking={onPhotoChecking}
                onFile={r.onFile}
              />
              <button
                data-track="staff.field.repair.button.9"
                disabled={busy || r.photoBusy || checkingPhotos}
                onClick={r.supplement}
              >
                重试补传照片
              </button>
            </section>
          )}
          {item.canTransfer && (
            <section className="field-form">
              <label className="field-check">
                <input
                  data-track="staff.field.repair.input.10"
                  type="checkbox"
                  checked={received}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                我已实际接到设备，确认成为当前主修
              </label>
              <button
                data-track="staff.field.repair.button.11"
                disabled={busy || !received}
                onClick={r.handoff}
              >
                确认接手
              </button>
            </section>
          )}
          {(item.canFinish || item.canCorrect) && (
            <form
              data-track="staff.field.repair.form.12"
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
                      data-track="staff.field.repair.input.13"
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
                  data-track="staff.field.repair.textarea.14"
                  required
                  maxLength={1000}
                  value={r.note}
                  onChange={(e) => r.setNote(e.target.value)}
                  placeholder="说明处理结果；部分解决或未解决时写清剩余问题"
                />
              </label>
              <button
                data-track="staff.field.repair.button.15"
                className="field-primary"
                disabled={busy}
              >
                {item.canFinish ? '结束本次服务' : '保存结果更正'}
              </button>
            </form>
          )}
          {item.status === 'completed' && (
            <p>
              {(item.outcome && outcomeLabels[item.outcome]) || '历史未分类'} · {item.repairNote}
            </p>
          )}
          <RepairRelations
            key={id}
            item={item}
            onChanged={() => {
              void r.load();
            }}
            onOpen={onOpen}
          />
          <section className="repair-tools" aria-label="维修信息">
            <h3>维修信息</h3>
            <RepairAttachments key={`attachments-${id}`} id={id} />
            <div className="repair-action-row repair-information-row">
              {!item.canEdit && !item.receivedAt && item.canStart && (
                <details
                  data-track="staff.field.repair.details.1"
                  className="field-details repair-device-correction"
                >
                  <summary
                    data-track="staff.field.repair.summary.2"
                    className="repair-tool-trigger"
                  >
                    修改设备信息
                  </summary>
                  <div className="field-form-grid">
                    <label>
                      品牌
                      <input
                        data-track="staff.field.repair.input.3"
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
                        data-track="staff.field.repair.input.4"
                        maxLength={120}
                        value={r.verification.model}
                        onChange={(e) =>
                          r.setVerification({ ...r.verification, model: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </details>
              )}
              {item.canEdit && (
                <RepairInformation
                  item={item}
                  onChanged={(values) => {
                    r.setVerification({
                      ...r.verification,
                      brand: values.brand.trim(),
                      model: values.deviceModel.trim(),
                      warranty: values.warranty,
                      liquidMetal: values.liquidMetal
                    });
                    void r.load();
                  }}
                />
              )}
            </div>
            {(item.repairHistory || item.original) && (
              <div className="repair-action-row repair-record-actions">
                <RepairHistory history={item.repairHistory} />
                <RepairOriginal original={item.original} />
              </div>
            )}
          </section>
          {!hideWarrantyLookup && (item.canStart || item.canTransfer || item.canFinish) && (
            <section className="repair-tools repair-official" aria-label="官方支持">
              <h3>官方支持</h3>
              <div className="repair-action-row repair-warranty-actions">
                <WarrantyLookupButton initialBrand={activeBrand} label="查询保修状态" />
                {serviceCenterUrl && (
                  <a
                    data-track="staff.field.repair.service-center"
                    href={serviceCenterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="repair-tool-trigger"
                    onClick={(event) => {
                      if (!tools) return;
                      event.preventDefault();
                      tools.request(null, () =>
                        window.open(serviceCenterUrl, '_blank', 'noopener,noreferrer')
                      );
                    }}
                  >
                    查找售后网点
                  </a>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}

export function Repair(props: Omit<Parameters<typeof RepairOrder>[0], 'onOpen'>) {
  const [id, setId] = useState(props.id);
  return (
    <RepairToolsProvider key={id}>
      <RepairOrder {...props} id={id} onOpen={setId} />
    </RepairToolsProvider>
  );
}
