import {
  ANSWERS,
  BRANDS,
  COLLEGES,
  FAULT_TYPES,
  STUDENT_DEVICE_TYPES
} from '../../shared/student-booking.ts';
import { PhotoCollection } from './PhotoCollection';
import { TimeSummary } from './presentation';
import type { BookingForm } from './use-booking-form';
import type { Photos } from './use-photos';
import type { BookingFields, SlotSummary } from './types';

type Input = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export function FieldError({ form, name }: { form: BookingForm; name: string }) {
  return (
    <span className="field-error" data-error-for={name} {...form.errorProps(name)}>
      {form.error(name)}
    </span>
  );
}
function Options({
  values,
  placeholder
}: {
  values: (string | { value: string; label: string })[];
  placeholder: string;
}) {
  return (
    <>
      <option value="">{placeholder}</option>
      {values.map((item) =>
        typeof item === 'string' ? (
          <option value={item} key={item}>
            {item}
          </option>
        ) : (
          <option value={item.value} key={item.value}>
            {item.label}
          </option>
        )
      )}
    </>
  );
}

export function DeviceStep({
  form,
  photos,
  time,
  busy,
  back,
  next
}: {
  form: BookingForm;
  photos: Photos;
  time: SlotSummary | null;
  busy: boolean;
  back: () => void;
  next: () => void;
}) {
  const show = form.conditions;
  const bind = (name: keyof BookingFields) => ({
    name,
    value: form.fields[name] || '',
    ...form.control(name),
    onChange: (event: React.ChangeEvent<Input>) =>
      form.change(
        name,
        event.currentTarget.value,
        'isComposing' in event.nativeEvent && event.nativeEvent.isComposing === true
      ),
    onCompositionEnd: (event: React.CompositionEvent<Input>) =>
      form.change(name, event.currentTarget.value)
  });
  const radio = (name: keyof BookingFields, value: string, disabled = false) => ({
    name,
    type: 'radio',
    value,
    checked: form.fields[name] === value,
    disabled,
    ...form.control(name),
    onChange: () => form.change(name, value)
  });
  const answers = (name: 'dellG15' | 'liquidMetal' | 'warranty', disabled = false) => (
    <div className="radio-options" data-answer={name}>
      {ANSWERS.map((answer) => (
        <label key={answer}>
          <input data-track="student.booking.input.1" {...radio(name, answer, disabled)} />
          <span>{answer}</span>
        </label>
      ))}
    </div>
  );
  return (
    <section data-step="2" hidden={form.step !== 2}>
      <div className="step-heading">
        <h2 tabIndex={-1}>设备、故障与联系方式</h2>
      </div>
      <div className="selection-summary" id="step-two-time">
        {time && <TimeSummary item={time} />}
      </div>
      <button
        data-track="student.index.button.12"
        className="text-btn"
        type="button"
        data-edit-step="1"
        disabled={busy}
        onClick={back}
      >
        修改到场时间
      </button>
      <section className="form-block">
        <h3>设备信息</h3>
        <label className="field">
          设备类型 <i>*</i>
          <select data-track="student.index.select.13" required {...bind('deviceType')}>
            <Options values={STUDENT_DEVICE_TYPES} placeholder="请选择设备类型" />
          </select>
          <FieldError form={form} name="deviceType" />
        </label>
        <label className="field">
          品牌 <i>*</i>
          <select data-track="student.index.select.14" required {...bind('brand')}>
            <Options
              values={[...BRANDS, { value: 'other', label: '其它' }]}
              placeholder="请选择品牌"
            />
          </select>
          <FieldError form={form} name="brand" />
        </label>
        <label className="field" id="brand-other-field" hidden={!show.brandOther}>
          其他品牌完整名称 <i>*</i>
          <input
            data-track="student.index.input.15"
            data-max-length="30"
            disabled={!show.brandOther}
            {...bind('brandOther')}
          />
          <FieldError form={form} name="brandOther" />
        </label>
        <label className="field">
          设备型号{' '}
          <input
            data-track="student.index.input.16"
            data-max-length="60"
            placeholder="例如 ThinkPad T14"
            {...bind('deviceModel')}
          />
          <FieldError form={form} name="deviceModel" />
        </label>
        <fieldset className="field" id="dell-g15-field" hidden={!show.dellG15}>
          <legend>你的电脑是 游匣 G15 / G16 系列的吗？</legend>
          {answers('dellG15', !show.dellG15)}
          <FieldError form={form} name="dellG15" />
        </fieldset>
        <fieldset className="field" id="liquid-metal-field" hidden={!show.liquidMetal}>
          <legend>
            你的电脑是否使用液金 <i>*</i>
          </legend>
          {answers('liquidMetal', !show.liquidMetal)}
          <FieldError form={form} name="liquidMetal" />
        </fieldset>
        <fieldset className="field">
          <legend>
            是否在保 <i>*</i>
          </legend>
          {answers('warranty')}
          <FieldError form={form} name="warranty" />
        </fieldset>
      </section>
      <section className="form-block">
        <h3>故障说明</h3>
        <fieldset className="field">
          <legend>
            故障分类 <i>*</i>
          </legend>
          <div className="radio-options fault-options" id="fault-options">
            {FAULT_TYPES.map((value) => (
              <label key={value}>
                <input data-track="student.booking.input.2" {...radio('faultType', value)} />
                <span>{value}</span>
              </label>
            ))}
          </div>
          <FieldError form={form} name="faultType" />
          <div
            ref={form.advice}
            id="fault-advice"
            className="fault-advice"
            role="status"
            hidden={!form.hint}
          >
            <span className="advice-icon" aria-hidden="true">
              i
            </span>
            <div>
              <strong id="fault-advice-title">{form.hint && form.fields.faultType + '须知'}</strong>
              <p id="fault-advice-message">{form.hint}</p>
            </div>
          </div>
        </fieldset>
        <label className="field">
          故障描述与补充说明{' '}
          <i id="issue-required" hidden={form.fields.faultType !== '其他'}>
            *
          </i>
          <textarea
            data-track="student.index.textarea.17"
            rows={5}
            data-max-length="1000"
            placeholder="描述设备遇到的问题，也可以粘贴故障视频网盘链接"
            required={form.fields.faultType === '其他'}
            {...bind('issue')}
          />
          <FieldError form={form} name="issue" />
        </label>
        <div className="field">
          <h4>故障照片</h4>
          <PhotoCollection id="booking-photos" inputId="appointment-attachments" photos={photos} />
        </div>
      </section>
      <section className="form-block">
        <h3>机主与联系方式</h3>
        <label className="field">
          姓名 <i>*</i>
          <input
            data-track="student.index.input.18"
            data-max-length="20"
            required
            autoComplete="off"
            {...bind('name')}
          />
          <FieldError form={form} name="name" />
        </label>
        <label className="field">
          学号 <i>*</i>
          <input
            data-track="student.index.input.19"
            data-max-length="20"
            required
            inputMode="numeric"
            autoComplete="off"
            {...bind('studentId')}
          />
          <FieldError form={form} name="studentId" />
        </label>
        <label className="field">
          学院 <i>*</i>
          <select data-track="student.index.select.20" required {...bind('college')}>
            <Options
              values={[...COLLEGES, { value: 'other', label: '其他学院（手动填写）' }]}
              placeholder="请选择学院"
            />
          </select>
          <FieldError form={form} name="college" />
        </label>
        <label className="field" id="college-other-field" hidden={!show.collegeOther}>
          学院完整名称 <i>*</i>
          <input
            data-track="student.index.input.21"
            data-max-length="50"
            disabled={!show.collegeOther}
            {...bind('collegeOther')}
          />
          <FieldError form={form} name="collegeOther" />
        </label>
        <label className="field">
          联系邮箱{' '}
          <input
            data-track="student.index.input.22"
            type="email"
            data-max-length="254"
            inputMode="email"
            autoComplete="email"
            {...bind('email')}
          />
          <FieldError form={form} name="email" />
        </label>
        <fieldset className="field">
          <legend>
            QQ / 微信 <i>*</i>
          </legend>
          <div className="radio-options">
            <label>
              <input data-track="student.index.input.23" {...radio('contactType', 'qq')} />
              <span>QQ</span>
            </label>
            <label>
              <input data-track="student.index.input.24" {...radio('contactType', 'wechat')} />
              <span>微信</span>
            </label>
          </div>
          <FieldError form={form} name="contactType" />
        </fieldset>
        <label className="field" id="contact-qq-field" hidden={!show.qqAccount}>
          QQ 账号 <i>*</i>
          <input
            data-track="student.index.input.25"
            data-max-length="12"
            inputMode="numeric"
            disabled={!show.qqAccount}
            {...bind('qqAccount')}
          />
          <FieldError form={form} name="qqAccount" />
        </label>
        <label className="field" id="contact-wechat-field" hidden={!show.wechatAccount}>
          微信账号 <i>*</i>
          <input
            data-track="student.index.input.26"
            data-max-length="20"
            disabled={!show.wechatAccount}
            {...bind('wechatAccount')}
          />
          <FieldError form={form} name="wechatAccount" />
        </label>
      </section>
      <div className="step-actions">
        <button
          data-track="student.index.button.27"
          className="secondary-btn"
          type="button"
          data-edit-step="1"
          disabled={busy}
          onClick={back}
        >
          上一步
        </button>
        <button
          data-track="student.index.button.28"
          className="primary-btn"
          id="step-two-next"
          type="button"
          onClick={next}
        >
          下一步 · 核对预约
        </button>
      </div>
    </section>
  );
}
