import { useDialogs } from './dialogs';
import { FieldError } from './DeviceStep';
import { InformationGroups, TimeSummary } from './presentation';
import { ConfirmedSignature } from './SignatureDialog';
import type { BookingForm } from './use-booking-form';
import type { Signature, SlotSummary, Step } from './types';

export function ReviewStep({
  form,
  time,
  photoCount,
  signature,
  busy,
  edit
}: {
  form: BookingForm;
  time: SlotSummary | null;
  photoCount: number;
  signature: Signature | null;
  busy: boolean;
  edit: (next: Step) => void;
}) {
  const { open } = useDialogs();
  return (
    <section data-step="3" hidden={form.step !== 3}>
      <div className="step-heading">
        <h2 tabIndex={-1}>核对预约并签名</h2>
      </div>
      <div className="selection-summary" id="step-three-time">
        {time && <TimeSummary item={time} />}
      </div>
      <button
        data-track="student.index.button.29"
        className="text-btn"
        type="button"
        data-edit-step="1"
        disabled={busy}
        onClick={() => edit(1)}
      >
        修改时间
      </button>
      <div id="booking-review">
        {time && <InformationGroups item={{ ...form.data(), photoCount }} />}
      </div>
      <button
        data-track="student.index.button.30"
        className="text-btn"
        type="button"
        data-edit-step="2"
        disabled={busy}
        onClick={() => edit(2)}
      >
        修改设备和联系方式
      </button>
      <aside className="booking-preparation" aria-label="到场准备">
        <p>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 4-3 8v7a1 1 0 0 0 1 1h20a1 1 0 0 0 1-1v-7l-3-8H4Z M1 12h22 M5 16h.01 M9 16h.01" />
          </svg>
          <span>
            <strong>提前备份重要数据</strong>，避免维修过程中造成数据丢失。
          </span>
        </p>
        <p>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 2v6 M16 2v6 M5 8h14v5a7 7 0 0 1-14 0V8Z M12 20v3" />
          </svg>
          <span>
            <strong>携带设备及对应电源适配器</strong>，方便现场检查和维修。
          </span>
        </p>
      </aside>
      <section className="form-block">
        <h3>协议与手写签名</h3>
        <label className="agreement-check">
          <input
            data-track="student.index.input.31"
            type="checkbox"
            name="agreement"
            checked={form.agreement}
            {...form.control('agreement')}
            onChange={(event) => form.setAgreement(event.currentTarget.checked)}
          />
          <span>
            我已阅读并同意
            <a
              data-track="student.index.a.32"
              href="#agreement"
              id="agreement-link"
              onClick={(event) => {
                event.preventDefault();
                open({ kind: 'agreement' });
              }}
            >
              《先锋网络中心先锋维修知情同意书》
            </a>
          </span>
        </label>
        <FieldError form={form} name="agreement" />
        <button
          data-track="student.index.button.33"
          id="open-signature"
          className="secondary-btn"
          type="button"
          {...form.control('signature', 'signature-status')}
          onClick={() => open({ kind: 'signature' })}
        >
          {signature ? '重新手写签名' : '手写本人姓名'}
        </button>
        <p id="signature-status" role="status">
          {signature ? '已完成手写签名。' : '尚未完成手写签名。'}
        </p>
        <ConfirmedSignature value={signature} />
        <FieldError form={form} name="signature" />
      </section>
      <div className="step-actions">
        <button
          data-track="student.index.button.34"
          className="secondary-btn"
          type="button"
          data-edit-step="2"
          disabled={busy}
          onClick={() => edit(2)}
        >
          上一步
        </button>
        <button
          data-track="student.index.button.35"
          className="primary-btn"
          id="booking-submit"
          type="submit"
          disabled={busy}
        >
          {busy ? '正在核实并提交…' : '确认并提交预约'}
        </button>
      </div>
    </section>
  );
}
