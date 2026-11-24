import { SlotPicker } from './SlotPicker';
import { DeviceStep } from './DeviceStep';
import { ReviewStep } from './ReviewStep';
import { BookingSuccess } from './BookingSuccess';
import { useReveal } from './motion';
import type { Appointment } from './types';
import type { Booking } from './use-booking';

export function BookingView({
  booking,
  active,
  detail,
  list
}: {
  booking: Booking;
  active: boolean;
  detail: (item: Appointment) => void;
  list: () => void;
}) {
  const { form, picker, announcements, created, error, notice } = booking;
  const errorRef = useReveal<HTMLParagraphElement>(error, 4);
  const noticeRef = useReveal<HTMLParagraphElement>(notice, 4);
  const { campus, date, timeSlot } = picker.selection;
  return (
    <section
      className={'view' + (active ? ' is-active' : '')}
      id="booking-view"
      data-view="booking"
    >
      <div id="booking-heading" className="student-heading" hidden={!!created}>
        <h1>预约维修</h1>
      </div>
      <div
        id="draft-prompt"
        className="notice"
        hidden={!booking.savedDraft}
        role="region"
        aria-label="恢复预约草稿"
      >
        <p>发现未完成的预约，是否继续填写？</p>
        <div className="actions">
          <button
            data-track="student.index.button.4"
            type="button"
            id="draft-discard"
            className="secondary-btn"
            onClick={booking.discard}
          >
            重新填写
          </button>
          <button
            data-track="student.index.button.5"
            type="button"
            id="draft-restore"
            className="primary-btn"
            onClick={() => void booking.restore()}
          >
            恢复填写
          </button>
        </div>
      </div>
      <p ref={noticeRef} id="draft-notice" className="notice" role="status" hidden={!notice}>
        {notice}
      </p>
      <ol id="booking-steps" className="step-track" aria-label="预约步骤" hidden={!!created}>
        {['到场时间', '设备信息与联系方式', '核对与签名'].map((label, index) => (
          <li key={label} aria-current={form.step === index + 1 ? 'step' : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <p ref={errorRef} id="booking-error" className="notice is-error" role="alert" hidden={!error}>
        {error}
      </p>
      <form
        ref={form.formRef}
        data-track="student.index.form.6"
        id="booking-form"
        className="student-form"
        noValidate
        hidden={!!created}
        onSubmit={(event) => {
          event.preventDefault();
          void booking.submit();
        }}
      >
        <input data-track="student.index.input.7" name="campus" type="hidden" value={campus} />
        <input data-track="student.index.input.8" name="date" type="hidden" value={date} />
        <input data-track="student.index.input.9" name="timeSlot" type="hidden" value={timeSlot} />
        <SlotPicker
          picker={picker}
          announcements={announcements}
          hidden={form.step !== 1}
          next={() => void booking.nextTime()}
          checking={booking.checking}
        />
        <DeviceStep
          form={form}
          photos={booking.photos}
          time={booking.time}
          busy={booking.busy}
          back={() => booking.edit(1)}
          next={booking.nextDevice}
        />
        <ReviewStep
          form={form}
          time={booking.time}
          photoCount={booking.photos.entries.length}
          signature={booking.signature}
          busy={booking.busy}
          edit={booking.edit}
        />
      </form>
      <BookingSuccess booking={booking} detail={detail} list={list} />
    </section>
  );
}
