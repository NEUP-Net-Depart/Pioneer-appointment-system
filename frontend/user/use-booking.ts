import { useEffect, useRef, useState } from 'react';
import { track } from '../../shared/telemetry-client.ts';
import { AGREEMENT_VERSION } from '../../shared/student-booking.ts';
import { failureFrom, studentJson, type Failure } from './api';
import { saveAppointment } from './credentials';
import { useBookingNotices } from './BookingNotices';
import {
  clearAttempt,
  clearDraft,
  readAttempt,
  readDraft,
  requestKey,
  writeAttempt,
  writeDraft
} from './draft';
import { useAvailability } from './use-availability';
import { useBookingForm } from './use-booking-form';
import { useCurrent } from './use-current';
import { usePhotos } from './use-photos';
import type {
  Appointment,
  BookingFields,
  FieldErrors,
  Signature,
  SlotSelection,
  SlotSummary,
  Step
} from './types';

const slotFailures = [
  'BOOKING_NOTICE_CHANGED',
  'SERVICE_DAY_PAUSED',
  'SLOT_FULL',
  'SLOT_PAUSED',
  'SLOT_ENDED',
  'SLOT_CHANGED',
  'DATE_UNAVAILABLE',
  'LOCATION_MISSING'
];
const controls = ['', 'booking.step.1', 'booking.step.2', 'booking.step.3'];
const deviceError = (name: string) => name !== 'agreement' && name !== 'signature';

function rejected(control: string, reason: string, fields = {}) {
  track(control === 'booking.submit' ? 'flow.result' : 'flow.step', {
    control,
    result: 'rejected',
    reason,
    ...fields
  });
}
function submitFailure(
  failure: Failure,
  reason = failure.code ||
    (failure.status && failure.status < 500 ? 'HTTP_REJECTED' : 'OUTCOME_UNCONFIRMED')
) {
  track('flow.result', {
    control: 'booking.submit',
    result: failure.status && failure.status < 500 ? 'rejected' : 'error',
    reason,
    errorCode: failure.code,
    requestId: failure.requestId,
    status: failure.status,
    failureFields: Object.keys(failure.fields || {})
  });
}

export function useBooking(
  active: boolean,
  onCreated: (item: Appointment) => void,
  activation: number
) {
  const [savedDraft, setSavedDraft, draftRef] = useCurrent(readDraft);
  const [created, setCreated, createdRef] = useCurrent<Appointment | null>(null);
  const [busy, setBusy, busyRef] = useCurrent(false);
  const [checking, setChecking, checkingRef] = useCurrent(false);
  const [signature, setSignature, signatureRef] = useCurrent<Signature | null>(null);
  const [time, setTime] = useState<SlotSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentialSaved, setCredentialSaved] = useState(true);
  const [deferred, setDeferred] = useState(false);
  const [initialAttempt] = useState(readAttempt);
  const attempt = useRef(initialAttempt);
  const firstRecovery = useRef<Promise<Appointment | null> | null>(null);
  const recovering = useRef(false);
  const restoring = useRef(false);
  const agreementAt = useRef<string | undefined>(undefined);
  const photos = usePhotos();
  const form = useBookingForm((fields) => saveDraft(fields));
  const picker = useAvailability((selection, issue) => {
    saveDraft(form.currentFields.current, selection);
    if (form.currentStep.current > 1 && !createdRef.current) {
      setTime(picker.value());
      if (issue) setError(issue + '其他已填信息已保留。');
    }
  });
  const announcements = useBookingNotices(
    picker.selection.campus,
    picker.notices,
    form.step === 1,
    active && !created
  );
  useEffect(() => {
    picker.setActive(active && !created);
    if (!active && created) photos.pauseUpload();
  }, [active, created, activation]);

  function saveDraft(fields: BookingFields, selection: SlotSelection = picker.value()) {
    if (restoring.current || createdRef.current || draftRef.current || busyRef.current) return;
    const { campus, date, timeSlot } = selection;
    const values = { campus, date, timeSlot, ...fields };
    if (Object.values(values).some(Boolean) && !writeDraft(values, form.currentStep.current))
      setNotice('此浏览器无法保存草稿，请避免刷新页面。');
  }
  function go(step: Step) {
    track('flow.step', { control: controls[step], result: 'start' });
    form.go(step);
    if (step > 1) setTime(picker.value());
    saveDraft(form.currentFields.current);
  }
  const hasNotices = () => announcements.missing(picker.currentNotices(), picker.value().campus);
  const confirmNotices = (show?: boolean) =>
    announcements.confirm(picker.currentNotices(), picker.value().campus, show);
  function validationFailure(control: string, errors: FieldErrors) {
    const values: Record<string, unknown> = {
      ...form.data(),
      agreement: form.currentAgreement.current,
      signature: signatureRef.current
    };
    const failureFields = Object.keys(errors),
      missingFields = failureFields.filter((key) => !values[key] || !String(values[key]).trim());
    const invalidFields = failureFields.filter((key) => !missingFields.includes(key));
    rejected(control, invalidFields.length ? 'FIELD_INVALID' : 'FIELD_REQUIRED', {
      failureFields,
      missingFields,
      invalidFields
    });
  }
  function photoFailure(control: string) {
    rejected(
      control,
      photos.current.current.some((entry) => entry.state === 'preparing')
        ? 'PHOTO_PREPARING'
        : 'PHOTO_PREPARATION_FAILED'
    );
  }
  function slotFailure(control: string) {
    const { campus, date, timeSlot } = picker.value();
    const missingFields = Object.entries({ campus, date, timeSlot })
      .filter(([, value]) => !value)
      .map(([key]) => key);
    rejected(
      control,
      picker.issue() || !missingFields.length ? 'SLOT_UNAVAILABLE' : 'SLOT_SELECTION_REQUIRED',
      { missingFields }
    );
  }

  async function nextTime() {
    if (busyRef.current || checkingRef.current) return;
    setChecking(true);
    try {
      if (!(await picker.refresh())) {
        rejected('booking.step.1', 'AVAILABILITY_REFRESH_FAILED');
        return;
      }
      if (!picker.validate()) {
        slotFailure('booking.step.1');
        return;
      }
      if (!confirmNotices()) {
        rejected('booking.step.1', 'NOTICE_UNACCEPTED');
        return;
      }
      setError('');
      go(2);
    } finally {
      setChecking(false);
    }
  }
  function nextDevice() {
    const errors = form.fieldErrors();
    form.showErrors(errors);
    if (Object.keys(errors).length) {
      validationFailure('booking.step.2', errors);
      return;
    }
    if (!photos.validity()) {
      photoFailure('booking.step.2');
      return;
    }
    if (!picker.validate()) {
      slotFailure('booking.step.2');
      go(1);
      setError('原到场时段当前不可预约，请重新选择。其他已填信息已保留。');
      return;
    }
    setError('');
    go(3);
    void picker.refresh();
  }

  function showSuccess(item: Appointment, reason = 'CREATED') {
    track('flow.result', { control: 'booking.submit', result: 'ok', reason });
    setCreated(item);
    setDeferred(false);
    setCredentialSaved(saveAppointment(item));
    clearDraft();
    clearAttempt();
    attempt.current = null;
    agreementAt.current = undefined;
    setSavedDraft(null);
    setNotice('');
    setError('');
    picker.setActive(false);
    onCreated(item);
    void photos.uploadAll(item);
  }
  async function resolve() {
    if (!attempt.current) return null;
    const result = await studentJson<{ found: boolean; appointment: Appointment }>(
      '/api/booking-attempts/resolve',
      {
        method: 'POST',
        json: { requestKey: attempt.current.key }
      }
    );
    return result.found ? result.appointment : null;
  }
  function accessUnavailable(failure: Failure) {
    if (attempt.current) {
      attempt.current.pending = false;
      writeAttempt(attempt.current);
    }
    setError(failure.message);
  }
  function forgetAttempt() {
    attempt.current = null;
    agreementAt.current = undefined;
    clearAttempt();
  }
  useEffect(() => {
    if (!attempt.current?.pending) return;
    let disposed = false;
    recovering.current = true;
    setError('上次提交结果待核实，正在安全查询…');
    firstRecovery.current ||= resolve();
    void firstRecovery.current
      .then(
        (found) => {
          if (disposed) return;
          if (found) showSuccess(found, 'RECOVERED');
          else setError('暂未查到创建结果，请恢复草稿并重新勾选协议、签名后，用原提交标识重试。');
        },
        (value) => {
          if (disposed) return;
          const failure = failureFrom(value);
          if (failure.code === 'BOOKING_ACCESS_UNAVAILABLE') accessUnavailable(failure);
          else setError('暂时无法确认上次提交结果，请保持原提交标识并重试核实。');
        }
      )
      .finally(() => {
        if (!disposed) recovering.current = false;
      });
    return () => {
      disposed = true;
    };
  }, []);
  async function submit() {
    if (busyRef.current || recovering.current || createdRef.current) return;
    track('flow.result', { control: 'booking.submit', result: 'start' });
    setBusy(true);
    setError('');
    try {
      if (attempt.current?.pending) {
        const found = await resolve();
        if (found) {
          showSuccess(found, 'RECOVERED');
          return;
        }
      }
      const values = form.data(),
        errors = form.fieldErrors();
      const signed = signatureRef.current;
      if (!form.currentAgreement.current) errors.agreement = '请阅读并同意维修协议';
      if (!signed) errors.signature = '请点击“手写本人姓名”完成签名';
      if (Object.keys(errors).some(deviceError)) {
        validationFailure('booking.submit', errors);
        go(2);
        form.showErrors(errors);
        return;
      }
      form.showErrors(errors);
      if (Object.keys(errors).length) {
        validationFailure('booking.submit', errors);
        return;
      }
      if (!photos.validity()) {
        photoFailure('booking.submit');
        return;
      }
      if (!(await picker.refresh())) {
        rejected('booking.submit', 'AVAILABILITY_REFRESH_FAILED');
        setError('暂时无法核实时段和地点，请重试。已填信息已保留。');
        return;
      }
      if (!picker.validate()) {
        slotFailure('booking.submit');
        go(1);
        setError('到场时段当前不可预约，请重新选择。其他信息已保留。');
        return;
      }
      if (hasNotices()) {
        rejected('booking.submit', 'NOTICE_UNACCEPTED');
        go(1);
        setError('所选校区有尚未确认的必读公告，请阅读确认后继续。已填信息和签名已保留。');
        confirmNotices(active && !document.hidden);
        return;
      }
      const { brandOther, collegeOther, qqAccount, wechatAccount, ...business } = values;
      const { campus, date, timeSlot } = picker.value();
      const payload = {
        campus,
        date,
        timeSlot,
        ...business,
        acceptedNotices: announcements.confirmed(picker.currentNotices(), campus),
        agreementAccepted: true,
        agreementAt: (agreementAt.current ||= new Date().toISOString()),
        agreementVersion: AGREEMENT_VERSION,
        signature: signatureRef.current
      };
      attempt.current ||= { key: requestKey() };
      attempt.current.pending = true;
      if (!writeAttempt(attempt.current))
        setNotice('此浏览器无法保存提交标识。如网络中断，请保持页面打开并重试。');
      try {
        showSuccess(
          await studentJson<Appointment>('/api/appointments', {
            method: 'POST',
            headers: { 'Idempotency-Key': attempt.current.key },
            json: payload
          })
        );
      } catch (value) {
        const failure = failureFrom(value);
        if (failure.code === 'BOOKING_ACCESS_UNAVAILABLE') throw failure;
        let found;
        try {
          found = await resolve();
        } catch (value) {
          const recoveryFailure = failureFrom(value);
          if (recoveryFailure.code === 'BOOKING_ACCESS_UNAVAILABLE') throw recoveryFailure;
          submitFailure(failure, 'OUTCOME_UNCONFIRMED');
          setError(
            '暂时无法确认预约是否创建。请保持页面和原提交标识，点击提交重试核实；不要另开新预约。'
          );
          return;
        }
        if (found) {
          showSuccess(found, 'RECOVERED');
          if (failure.code === 'IDEMPOTENCY_MISMATCH')
            setNotice('原请求已经创建成功，当前展示的是原预约。后续修改没有另行提交。');
          return;
        }
        submitFailure(failure);
        if (slotFailures.includes(failure.code || '')) {
          forgetAttempt();
          if (failure.code === 'BOOKING_NOTICE_CHANGED') {
            await picker.refresh();
            go(1);
            confirmNotices(active && !document.hidden);
          } else {
            go(1);
            await picker.recover(failure.message);
          }
          setError(failure.message + '。其他信息和有效签名已保留。');
        } else if (failure.code === 'FIELD_INVALID') {
          forgetAttempt();
          go(Object.keys(failure.fields || {}).some(deviceError) ? 2 : 3);
          form.showErrors(failure.fields || {});
          setError(failure.message);
        } else if (failure.status && failure.status < 500) {
          forgetAttempt();
          setError(failure.message);
        } else setError('尚未确认创建结果。可使用原提交标识安全重试核实，已填内容已保留。');
      }
    } catch (value) {
      const failure = failureFrom(value);
      submitFailure(failure);
      if (failure.code === 'BOOKING_ACCESS_UNAVAILABLE') accessUnavailable(failure);
      else setError(failure.message || '暂时无法核实预约结果，请保持页面并重试。');
    } finally {
      setBusy(false);
    }
  }

  return {
    form,
    picker,
    announcements,
    created,
    busy,
    checking,
    signature,
    time,
    error,
    notice,
    savedDraft,
    credentialSaved,
    deferred,
    photos,
    nextTime,
    nextDevice,
    submit,
    edit(step: Step) {
      if (!busyRef.current) {
        setError('');
        go(step);
      }
    },
    confirmSignature(value: Signature) {
      setSignature(value);
      form.clearError('signature');
    },
    discard() {
      setSavedDraft(null);
      clearDraft();
    },
    async restore() {
      const draft = draftRef.current;
      if (!draft || restoring.current) return;
      restoring.current = true;
      form.reset(draft.fields);
      setSignature(null);
      photos.reset();
      await picker.restore(draft.fields);
      restoring.current = false;
      setSavedDraft(null);
      setNotice('已恢复文本和选择。请重新选择照片、勾选协议并完成手写签名。');
      const valid = picker.validate() && !hasNotices();
      go(
        valid
          ? (Math.min(
              Object.keys(form.fieldErrors()).length ? 2 : 3,
              Math.max(1, draft.step || 1)
            ) as Step)
          : 1
      );
    },
    hasDraft: () =>
      !!(
        !createdRef.current &&
        (draftRef.current ||
          readDraft() ||
          Object.values(form.currentFields.current).some(Boolean) ||
          picker.value().campus)
      ),
    hasPending: () => !!attempt.current?.pending,
    reset() {
      if (busyRef.current || attempt.current?.pending) return false;
      photos.reset();
      setSignature(null);
      picker.reset();
      announcements.reset();
      form.reset();
      clearDraft();
      forgetAttempt();
      setSavedDraft(null);
      setCreated(null);
      setNotice('');
      setError('');
      setTime(null);
      picker.setActive(active);
      go(1);
      return true;
    },
    retryPhotos() {
      if (created) {
        setDeferred(false);
        void photos.uploadAll(created);
      }
    },
    deferPhotos() {
      setDeferred(true);
      photos.pauseUpload();
    }
  };
}
export type Booking = ReturnType<typeof useBooking>;
