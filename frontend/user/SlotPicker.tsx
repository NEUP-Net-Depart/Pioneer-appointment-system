import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { CAMPUSES, TIME_SLOTS } from '../../shared/constants.ts';
import { BookingNotices, type BookingAnnouncements } from './BookingNotices';
import { reduced } from './motion';
import type { Availability } from './use-availability';

const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' });

function RemainingCount({ remaining }: { remaining?: number }) {
  const root = useRef<HTMLSpanElement>(null);
  const last = useRef({ value: '', digits: '0' });
  const value = remaining === undefined ? 'pending' : String(remaining);
  const previous =
    value === last.current.value
      ? last.current.digits
      : /^\d+$/.test(last.current.value)
        ? last.current.value
        : '0';
  useLayoutEffect(() => {
    last.current = { value, digits: previous };
    const tracks = [...(root.current?.querySelectorAll<HTMLElement>('.booking-count-track') || [])];
    const animations = tracks.flatMap((track, index) => {
      const start = Number(track.dataset.start),
        end = Number(track.dataset.end);
      return start === end - 10
        ? []
        : [
            track.animate(
              [
                { transform: 'translateY(-' + start + 'em)' },
                { transform: 'translateY(-' + end + 'em)' }
              ],
              { duration: 380 + index * 25, easing: 'cubic-bezier(.18,.7,.25,1)' }
            )
          ];
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [value]);
  const reel = remaining !== undefined && !reduced() && previous !== value;
  return (
    <span ref={root} className="booking-remaining-count" data-value={value}>
      {remaining === undefined ? (
        '—'
      ) : !reel ? (
        value
      ) : (
        <>
          <span className="booking-count-value">{value}</span>
          <span className="booking-count-reel" aria-hidden="true">
            {[...value].map((digit, index) => {
              const start = Number(
                previous.padStart(value.length, '0').slice(-value.length)[index]
              );
              const target = Number(digit),
                end = target + (target <= start ? 10 : 0);
              return (
                <span className="booking-count-column" key={index}>
                  <span
                    className="booking-count-track"
                    data-start={start}
                    data-end={end}
                    style={{ transform: 'translateY(-' + end + 'em)' }}
                  >
                    {Array.from({ length: end + 1 }, (_, step) => (
                      <span key={step} className="booking-count-digit" data-digit={step % 10} />
                    ))}
                  </span>
                </span>
              );
            })}
          </span>
        </>
      )}
    </span>
  );
}
function Remaining({ label, remaining }: { label?: string; remaining?: number }) {
  return (
    <small>
      <span className="booking-remaining">
        {label || (
          <>
            剩余 <RemainingCount remaining={remaining} /> 名
          </>
        )}
      </span>
    </small>
  );
}
export function SlotPicker({
  picker,
  announcements,
  hidden,
  next,
  checking
}: {
  picker: Availability;
  announcements: BookingAnnouncements;
  hidden: boolean;
  next: () => void;
  checking: boolean;
}) {
  const { campus, date, timeSlot } = picker.selection;
  const selected = picker.selected,
    paused = !!selected?.paused;
  const announcement = picker.notices.find(
    (item) => item.type === 'suspension' && item.businessDate === date
  );
  const retry = !!campus && !picker.loading && (picker.loadFailed || !!picker.failed.size);
  return (
    <section
      ref={picker.root}
      data-step="1"
      className="booking-picker"
      id="booking-picker"
      aria-labelledby="booking-picker-title"
      aria-busy={picker.loading}
      hidden={hidden}
    >
      <BookingNotices notices={announcements} />
      <div className="booking-picker-heading">
        <div>
          <h2 id="booking-picker-title" tabIndex={-1}>
            校区与到场时间
          </h2>
        </div>
        <div
          ref={picker.campusButtons}
          className="booking-campuses"
          id="booking-campuses"
          role="group"
          aria-label="预约校区"
        >
          {CAMPUSES.map((value) => (
            <button
              key={value}
              data-track="student.slot-picker.dynamic.choice"
              type="button"
              className="booking-choice"
              data-campus={value}
              aria-pressed={campus === value}
              onClick={() => picker.selectCampus(value)}
            >
              <strong>{value + '校区'}</strong>
            </button>
          ))}
        </div>
      </div>
      <div id="booking-calendar" hidden={!campus}>
        <div className="booking-picker-body">
          <div className="booking-date-panel">
            <div className="booking-panel-heading">
              <h3 className="booking-panel-label">选择日期</h3>
            </div>
            <div
              className="booking-days"
              id="booking-days"
              role="group"
              aria-label="可预约日期"
              data-count={picker.dates.length}
              style={{ '--booking-day-count': Math.max(1, picker.dates.length) } as CSSProperties}
            >
              {picker.dates.map((value) => {
                const status = picker.dateStatus(value),
                  loading = status.kind === 'loading';
                return (
                  <button
                    key={value}
                    data-track="student.slot-picker.dynamic.choice"
                    type="button"
                    className="booking-choice"
                    data-date={value}
                    data-state={status.kind}
                    data-loading={loading}
                    aria-pressed={date === value}
                    disabled={loading || status.kind === 'error'}
                    onClick={() => picker.selectDate(value)}
                  >
                    <strong>
                      <span className="booking-weekday">
                        {weekday.format(new Date(value + 'T12:00:00+08:00'))}
                      </span>
                      <span className="booking-date-number">
                        {Number(value.slice(5, 7)) + '/' + Number(value.slice(8))}
                      </span>
                    </strong>
                    <Remaining label={status.label} remaining={status.remaining} />
                  </button>
                );
              })}
            </div>
            <div
              className="booking-empty"
              id="booking-empty"
              hidden={
                picker.loading || picker.loadFailed || !!picker.failed.size || !!picker.dates.length
              }
            >
              当前预约范围内暂无开放日期
            </div>
          </div>
          <div className="booking-time-panel" data-state={picker.dateStatus(date).kind}>
            <div className="booking-slot-placeholder">
              <div className="booking-panel-heading">
                <h3 className="booking-panel-label">选择到场时间</h3>
              </div>
              <p
                className="booking-placeholder-body"
                id="booking-slot-placeholder-text"
                aria-hidden="true"
              >
                {picker.loadFailed || picker.failed.size
                  ? '暂时无法读取到场时段，请重试。'
                  : picker.dates.length
                    ? '选择日期后查看各时段状态'
                    : '当前预约范围内暂无开放日期'}
              </p>
            </div>
            <div className="booking-slot-panel" id="booking-slot-panel" hidden={!picker.showSlots}>
              <div className="booking-panel-heading">
                <h3 id="booking-slot-title" className="booking-panel-label">
                  {paused ? '公告 · ' + (announcement?.title || '当日暂停维修') : '选择到场时间'}
                </h3>
                <p
                  id="booking-slot-context"
                  className="booking-slot-context"
                  role="status"
                  hidden={!paused}
                >
                  {paused
                    ? announcement?.content || selected?.pauseReason || '该校区当日暂停维修。'
                    : ''}
                </p>
              </div>
              <div
                ref={picker.slotButtons}
                className="booking-slots"
                id="booking-slots"
                role="group"
                aria-label="到场时间"
              >
                {TIME_SLOTS.map((value) => {
                  const state = picker.availability(date, value),
                    failed = picker.failed.has(date);
                  const kind = !state
                    ? 'loading'
                    : paused
                      ? 'paused'
                      : !selected?.location
                        ? 'missing'
                        : state.ended
                          ? 'ended'
                          : !state.capacity
                            ? 'unopened'
                            : !state.remaining
                              ? 'full'
                              : 'open';
                  return (
                    <button
                      key={value}
                      data-track="student.slot-picker.dynamic.choice"
                      type="button"
                      className="booking-choice"
                      data-slot={value}
                      data-loading={!state && picker.loading}
                      data-state={kind}
                      aria-pressed={timeSlot === value}
                      disabled={failed || !state || state.disabled}
                      onClick={() => picker.selectSlot(value)}
                    >
                      <strong>{value.split('–')[0]}</strong>
                      <Remaining
                        remaining={state?.remaining}
                        label={failed ? '暂时无法更新' : state?.disabled ? state.label : ''}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="selection-summary" id="booking-location" hidden={!date || paused}>
          {selected?.location
            ? '维修地点：' + selected.location
            : picker.loading
              ? '维修地点：更新中…'
              : '维修地点尚未配置'}
        </div>
      </div>
      <div className="booking-feedback" hidden={!picker.feedback && !retry}>
        <p id="booking-selection" role="status">
          {picker.feedback}
        </p>
        <button
          data-track="student.index.button.10"
          type="button"
          className="text-btn"
          id="booking-retry"
          hidden={!retry}
          onClick={() => void picker.refresh()}
        >
          重试
        </button>
      </div>
      <div className="step-actions">
        <button
          data-track="student.index.button.11"
          className="primary-btn"
          type="button"
          id="step-one-next"
          disabled={checking || picker.blocked}
          onClick={next}
        >
          {picker.blocked ? '请选择其他日期' : '下一步 · 填写设备信息'}
        </button>
      </div>
    </section>
  );
}
