import { useLayoutEffect, useRef } from 'react';
import {
  bookingDeviceQuestions,
  characterCount,
  FAULT_HINTS,
  STUDENT_FIELD_LIMITS,
  studentFieldErrors
} from '../../shared/student-booking.js';
import { reveal, useLayoutMotion } from './motion';
import { useCurrent } from './use-current';
import type { BookingFields, FieldErrors, Step } from './types';

const emptyFields: BookingFields = {
  deviceType: '',
  brand: '',
  brandOther: '',
  deviceModel: '',
  issue: '',
  name: '',
  studentId: '',
  college: '',
  collegeOther: '',
  email: '',
  qqAccount: '',
  wechatAccount: ''
};
const textLimits = {
  ...STUDENT_FIELD_LIMITS,
  brandOther: STUDENT_FIELD_LIMITS.brand,
  collegeOther: STUDENT_FIELD_LIMITS.college
};
const faultHints: Record<string, string> = FAULT_HINTS;

function conditions(fields: BookingFields) {
  const device = bookingDeviceQuestions(
    fields.deviceType,
    fields.brand === 'other' ? fields.brandOther.trim() : fields.brand
  );
  return {
    brandOther: fields.brand === 'other',
    collegeOther: fields.college === 'other',
    dellG15: device.dellG15,
    liquidMetal: device.liquidMetal,
    qqAccount: fields.contactType === 'qq',
    wechatAccount: fields.contactType === 'wechat'
  };
}
function normalize(fields: BookingFields): BookingFields {
  const show = conditions(fields);
  if (!show.brandOther) fields.brandOther = '';
  if (!show.collegeOther) fields.collegeOther = '';
  if (!show.dellG15) delete fields.dellG15;
  if (!show.liquidMetal) delete fields.liquidMetal;
  return fields;
}
const errorKey = (key: string) =>
  key === 'brandOther'
    ? 'brand'
    : key === 'collegeOther'
      ? 'college'
      : key === 'qqAccount' || key === 'wechatAccount'
        ? 'contactValue'
        : key;
function errorTarget(key: string, fields: BookingFields) {
  if (key === 'brand' && fields.brand === 'other') return 'brandOther';
  if (key === 'college' && fields.college === 'other') return 'collegeOther';
  if (key === 'contactValue') return fields.contactType === 'qq' ? 'qqAccount' : 'wechatAccount';
  return key;
}

export function useBookingForm(onChange: (fields: BookingFields) => void) {
  const [fields, setFields, currentFields] = useCurrent(emptyFields);
  const [step, setStep, currentStep] = useCurrent<Step>(1);
  const [errors, setErrors, currentErrors] = useCurrent<FieldErrors>({});
  const [marked, mark] = useCurrent(new Set<string>());
  const [cleared, clear, currentCleared] = useCurrent<FieldErrors>({});
  const [agreement, setAgreement, currentAgreement] = useCurrent(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focus = useRef({ step: false, errors: false });
  const measure = useLayoutMotion(formRef);
  const advice = useRef<HTMLDivElement>(null);
  const hint = faultHints[fields.faultType || ''] || '';
  useLayoutEffect(() => {
    if (hint) reveal(advice.current, { distance: 4 });
  }, [hint]);
  const previousErrors = useRef<FieldErrors>({});
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (focus.current.step) {
      const heading = form.querySelector<HTMLElement>('[data-step="' + step + '"] h2');
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
    const targets = [...form.querySelectorAll<HTMLElement>('[data-error-for]')];
    for (const target of targets) {
      const name = target.dataset.errorFor || '';
      if (errors[name] && errors[name] !== previousErrors.current[name])
        reveal(target, { distance: 4 });
    }
    if (focus.current.errors) {
      const first = targets.find((target) => target.textContent && !target.closest('[hidden]'));
      first?.closest('.field,.form-block')?.scrollIntoView({ block: 'center', behavior: 'auto' });
      const control =
        first?.dataset.errorFor === 'signature'
          ? form.querySelector<HTMLElement>('#open-signature')
          : first &&
            form.querySelector<HTMLElement>(
              '[name="' + first.dataset.errorFor + '"]:not(:disabled)'
            );
      control?.focus({ preventScroll: true });
    }
    focus.current = { step: false, errors: false };
    previousErrors.current = errors;
  });

  function data() {
    const values = currentFields.current;
    const brand = values.brand === 'other' ? values.brandOther.trim() : values.brand;
    const questions = bookingDeviceQuestions(values.deviceType, brand);
    return {
      ...values,
      brand,
      college: values.college === 'other' ? values.collegeOther.trim() : values.college,
      contactValue:
        values.contactType === 'qq'
          ? values.qqAccount.trim()
          : values.contactType === 'wechat'
            ? values.wechatAccount.trim()
            : '',
      liquidMetal: questions.liquidMetal ? values.liquidMetal : undefined,
      dellG15: questions.dellG15 ? values.dellG15 : undefined
    };
  }
  function fieldErrors() {
    const show: Partial<Record<keyof BookingFields, boolean>> = conditions(currentFields.current);
    const errors: FieldErrors = studentFieldErrors(data());
    for (const [key, limit] of Object.entries(textLimits)) {
      if (key === 'brand' || key === 'college') continue;
      const name = key as keyof BookingFields;
      if (show[name] !== false && characterCount(currentFields.current[name]) > limit)
        errors[errorKey(name)] = '必须在 ' + limit + ' 字以内';
    }
    return errors;
  }
  function showErrors(values: FieldErrors, shouldFocus = true) {
    const targets = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [errorTarget(key, currentFields.current), value])
    );
    measure();
    focus.current.errors = shouldFocus;
    setErrors(targets);
    mark(new Set([...marked, ...Object.keys(targets)]));
    clear({});
  }
  function clearError(name: string) {
    if (!currentErrors.current[name]) return;
    const next = { ...currentErrors.current };
    delete next[name];
    setErrors(next);
    // The confirmation controls retain their original description link.
    clear({ ...currentCleared.current, [name]: 'error-' + name });
  }
  function liveValidation() {
    if (currentStep.current !== 2) return;
    const failures = fieldErrors(),
      visible: FieldErrors = {};
    const shown: Partial<Record<keyof BookingFields, boolean>> = conditions(currentFields.current);
    for (const [key, error] of Object.entries(failures)) {
      const name = errorTarget(key, currentFields.current) as keyof BookingFields;
      const limit = textLimits[name as keyof typeof textLimits];
      if (
        shown[name] !== false &&
        (currentErrors.current[name] ||
          (limit && characterCount(currentFields.current[name]) > limit))
      )
        visible[key] = error;
    }
    showErrors(visible, false);
  }
  function change(name: keyof BookingFields, value: string, composing = false) {
    const next = { ...currentFields.current, [name]: value };
    if (composing) {
      setFields(next);
      return;
    }
    const before = conditions(currentFields.current),
      after = conditions(next);
    if (
      Object.keys(before).some(
        (key) => before[key as keyof typeof before] !== after[key as keyof typeof after]
      ) ||
      faultHints[currentFields.current.faultType || ''] !== faultHints[next.faultType || '']
    )
      measure({ resize: true });
    setFields(normalize(next));
    onChange(currentFields.current);
    liveValidation();
  }
  function reset(values: Partial<BookingFields> = {}) {
    setFields(
      normalize({
        ...emptyFields,
        ...Object.fromEntries(
          [
            ...Object.keys(emptyFields),
            'dellG15',
            'liquidMetal',
            'warranty',
            'faultType',
            'contactType'
          ]
            .filter((key) => Object.hasOwn(values, key))
            .map((key) => [key, values[key as keyof BookingFields]])
        )
      })
    );
    setAgreement(false);
  }
  return {
    fields,
    currentFields,
    agreement,
    currentAgreement,
    step,
    currentStep,
    formRef,
    advice,
    hint,
    conditions: conditions(fields),
    data,
    fieldErrors,
    showErrors,
    clearError,
    reset,
    change,
    setAgreement(value: boolean) {
      setAgreement(value);
      if (value) clearError('agreement');
    },
    go(next: Step) {
      measure({ stagger: true });
      focus.current.step = true;
      setStep(next);
    },
    errorProps(name: string) {
      return {
        id: marked.has(name) ? 'error-' + name : undefined,
        role: marked.has(name) ? 'alert' : undefined
      };
    },
    error(name: string) {
      return errors[name] || '';
    },
    control(name: string, base?: string) {
      const invalid = !!errors[name];
      return {
        'aria-invalid': invalid ? (true as const) : undefined,
        'aria-describedby':
          [base, invalid ? 'error-' + name : cleared[name]].filter(Boolean).join(' ') || undefined,
        'data-base-description': marked.has(name) ? base || '' : undefined
      };
    }
  };
}
export type BookingForm = ReturnType<typeof useBookingForm>;
