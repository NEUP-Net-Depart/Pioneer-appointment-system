import type { CSSProperties } from 'react';
import { formatDate, formatInstant } from '../../shared/time.ts';
import {
  appointmentStatusClass,
  appointmentStatusLabel,
  outcomeLabels,
  expirationMessage
} from '../../shared/constants.ts';
import type { Appointment, BookingFields, SlotSummary } from './types';

export const appointmentLocation = (item: SlotSummary) =>
  item.location || item.locationSnapshot || '维修地点未记录，请联系工作人员';
export const isAwaitingArrival = (item: Appointment) =>
  item.status === 'booked' && !item.receivedAt && item.source !== 'onsite';
export const timeLabel = (item: SlotSummary) =>
  item.source === 'onsite' ? '现场临时登记' : item.timeSlot?.split('–')[0];

export function TimeSummary({ item }: { item: SlotSummary }) {
  return (
    <>
      <strong>
        <span>{formatDate(item.date)}</span>
        <span className="summary-slot">{timeLabel(item)}</span>
      </strong>
      <p>{item.campus}校区</p>
      <p className="location">{appointmentLocation(item)}</p>
      {item.servicePaused && (
        <p className="is-error">该预约日期暂停维修，请联系工作人员确认后续安排。</p>
      )}
      {item.locationChanged && (
        <>
          <p className="is-error">维修地点已调整，请以最新地点为准。</p>
          <p>原地点：{item.locationSnapshot}</p>
        </>
      )}
    </>
  );
}

function Rows({ values }: { values: [string, string | undefined | null][] }) {
  return (
    <>
      {values
        .filter(([, value]) => value != null && value !== '')
        .map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </>
  );
}

function LongText({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <>
      <p className="record-note">
        <b>{label}：</b>
        {value.length > 280 ? value.slice(0, 180) + '…' : value}
      </p>
      {value.length > 280 && (
        <details data-track="student.presentation.details.1">
          <summary data-track="student.presentation.summary.2">{label} · 展开全文</summary>
          <p className="record-note">{value}</p>
        </details>
      )}
    </>
  );
}

const answerLabel = (value?: string) => (value === 'unknown' ? '不清楚' : value);
type Information = Partial<BookingFields> &
  Pick<Appointment, 'serial' | 'liquidDrop' | 'note' | 'contactValue' | 'phone' | 'social'> & {
    photoCount?: number;
  };

export function InformationGroups({
  item,
  photos = true,
  device = true,
  contacts = true,
  detail = false
}: {
  item: Information;
  photos?: boolean;
  device?: boolean;
  contacts?: boolean;
  detail?: boolean;
}) {
  const Heading = detail ? 'h2' : 'h3';
  const className = detail ? 'appointment-detail-section' : 'review-group';
  return (
    <>
      {device && (
        <section className={className}>
          <Heading>设备与故障</Heading>
          {detail && item.issue && (
            <p className="detail-fault-description">
              <strong>故障描述：</strong>
              {item.issue}
            </p>
          )}
          <dl>
            <Rows
              values={[
                ['设备类型', item.deviceType],
                ['品牌', item.brand],
                ['设备型号', item.deviceModel],
                ['液金散热', answerLabel(item.liquidMetal)],
                ['Dell G15/G16', item.dellG15],
                ['是否在保', answerLabel(item.warranty)],
                ['故障分类', item.faultType],
                ['历史序列号', item.serial],
                ['历史进液／跌落', item.liquidDrop]
              ]}
            />
          </dl>
          {!detail && <LongText label="故障描述与补充说明" value={item.issue} />}
          <LongText label="历史备注" value={item.note} />
          {photos && !!item.photoCount && (
            <p>{'已准备 ' + item.photoCount + ' 张故障照片，预约成功后上传。'}</p>
          )}
        </section>
      )}
      {contacts && (
        <section className={className}>
          <Heading>机主与联系方式</Heading>
          <dl>
            <Rows
              values={[
                ['姓名', item.name],
                ['学号', item.studentId],
                ['学院', item.college],
                ['联系邮箱', item.email],
                [item.contactType === 'qq' ? 'QQ' : '微信', item.contactValue],
                ['历史手机号', item.phone],
                ['历史 QQ／微信', !item.contactValue ? item.social : '']
              ]}
            />
          </dl>
        </section>
      )}
    </>
  );
}

export function statusExplanation(item: Appointment) {
  if (item.status === 'expired') return expirationMessage;
  if (item.status === 'booked' && item.receivedAt) return '';
  if (item.status === 'booked' && item.source === 'onsite')
    return '本次为现场临时登记，请与现场工作人员保持联系。';
  if (item.status === 'booked')
    return item.servicePaused
      ? '当天暂停维修，请联系工作人员确认安排。'
      : '预约当天其他服务时段也可到场。';
  return '';
}

export function LookupSchedule({ item }: { item: Appointment }) {
  const showArrival = isAwaitingArrival(item) && !item.servicePaused;
  const time = item.source === 'onsite' ? '' : timeLabel(item);
  const status = statusText(item);
  return (
    <>
      <div className="detail-overview-heading">
        <h2>{showArrival ? '到场时间' : item.source === 'onsite' ? '登记日期' : '原预约时间'}</h2>
        <span
          className="detail-status-backdrop"
          id="detail-status"
          style={{ '--detail-status-length': status.length } as CSSProperties}
        >
          {status}
        </span>
      </div>
      <p className="detail-schedule-time">
        <span>{formatDate(item.date)}</span>
        {time && (
          <>
            {' '}
            <span className="detail-time">{time}</span>
          </>
        )}
      </p>
      <p className="detail-location">
        <span className={item.locationChanged ? 'detail-location-label' : 'detail-visually-hidden'}>
          {item.locationChanged ? '最新维修地点' : '维修地点'}
        </span>
        <span>{item.campus}校区</span>
        <span aria-hidden="true"> · </span>
        <span>{appointmentLocation(item)}</span>
      </p>
    </>
  );
}

export function RepairRecord({ item }: { item: Appointment }) {
  if (!['completed', 'in_progress', 'cancelled'].includes(item.status)) return null;
  const completed = item.status === 'completed';
  const times: [string, string][] =
    item.status === 'cancelled'
      ? [['取消时间', formatInstant(item.completedAt || '')]]
      : [['实际开始时间', formatInstant(item.startedAt || '')]];
  if (completed) times.push(['完成时间', formatInstant(item.completedAt || '')]);
  return (
    <section className="appointment-detail-section">
      <h2>{completed ? '维修结果' : '预约记录'}</h2>
      {completed && (
        <p className="repair-result">
          {outcomeLabels[item.outcome as keyof typeof outcomeLabels] ||
            outcomeLabels.legacy_unknown}
        </p>
      )}
      <dl>
        <Rows values={times} />
      </dl>
    </section>
  );
}

export function statusText(item: Appointment) {
  if (item.status === 'booked') return item.receivedAt ? '已接收' : '已预约';
  return appointmentStatusLabel(item.status, item.outcome) || '状态未记录';
}

export function studentStatusClass(item: Appointment) {
  if (item.status === 'booked') return item.receivedAt ? 'status-received' : 'status-reserved';
  return appointmentStatusClass(item.status, item.outcome);
}
