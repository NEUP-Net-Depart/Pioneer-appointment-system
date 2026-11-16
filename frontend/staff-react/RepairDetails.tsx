import { useId, useState } from 'react';
import { api, Notice, Modal } from './field/ui';
import type { Appointment } from './field/types';
import { outcomeLabels, statusLabels } from '../../shared/constants.js';
import { formatInstant } from '../../shared/time.js';
import { useRepairTool, useRepairTools } from './RepairTools';
import { Select } from './SelectionControls';
import {
  ANSWERS,
  STUDENT_DEVICE_TYPES,
  FAULT_TYPES,
  bookingDeviceQuestions
} from '../../shared/student-booking.js';

const fields = {
  brand: '品牌',
  deviceModel: '设备型号',
  deviceType: '设备类型',
  serial: '设备序列号',
  warranty: '是否在保',
  liquidMetal: '是否使用液金散热',
  dellG15: 'Dell G15 / G16 系列',
  liquidDrop: '进水情况',
  faultType: '故障分类',
  issue: '故障描述与补充说明',
  name: '姓名',
  studentId: '学号',
  college: '学院',
  phone: '电话',
  social: '历史 QQ / 微信',
  email: '联系邮箱',
  contactType: 'QQ / 微信',
  contactValue: '联系账号',
  note: '登记备注'
};
const fieldOptions: Record<string, readonly string[]> = {
  deviceType: STUDENT_DEVICE_TYPES,
  faultType: FAULT_TYPES,
  warranty: ANSWERS,
  liquidMetal: ANSWERS,
  dellG15: ANSWERS,
  liquidDrop: ANSWERS,
  contactType: ['qq', 'wechat']
};
const optionLabels = {
  qq: 'QQ',
  wechat: '微信',
  unknown: '不清楚',
  yes: '是',
  no: '否',
  in_warranty: '是',
  expired: '否'
};
const fieldGroups = [
  {
    title: '设备与故障',
    keys: [
      'deviceType',
      'brand',
      'deviceModel',
      'warranty',
      'liquidMetal',
      'dellG15',
      'faultType',
      'issue'
    ]
  },
  {
    title: '机主与联系方式',
    keys: ['name', 'studentId', 'college', 'email', 'contactType', 'contactValue']
  },
  { title: '现场补充', keys: ['serial', 'liquidDrop', 'phone', 'social', 'note'] }
];
export function RepairInformation({
  item,
  onChanged
}: {
  item: Appointment;
  onChanged: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.keys(fields).map((key) => [
        key,
        key === 'note'
          ? item.original?.note || ''
          : key === 'deviceType' && item.deviceType === '笔记本电脑'
            ? '笔记本'
            : item[key] || ''
      ])
    )
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [baseline, setBaseline] = useState(values);
  const tool = useRepairTool('information', {
    dirty: Object.keys(fields).some((key) => values[key] !== baseline[key]),
    busy,
    save,
    discard: () => {
      setValues(baseline);
      setError('');
    }
  });
  const panelId = useId();
  const questions = bookingDeviceQuestions(
    values.deviceType === '笔记本电脑' ? '笔记本' : values.deviceType,
    values.brand
  );
  function changeField(key: string, value: string) {
    const next = { ...values, [key]: value };
    if (key === 'deviceType' || key === 'brand') {
      const applicable = bookingDeviceQuestions(next.deviceType, next.brand);
      if (!applicable.liquidMetal) next.liquidMetal = '';
      if (!applicable.dellG15) next.dellG15 = '';
    }
    setValues(next);
  }
  async function save() {
    if (busy) return false;
    const patch = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => value !== baseline[key])
    );
    if (!Object.keys(patch).length) return true;
    setBusy(true);
    setError('');
    try {
      await api(`/api/appointments/${encodeURIComponent(item.id)}/information`, {
        method: 'PATCH',
        body: { ...patch, revision: item.revision, requestId: crypto.randomUUID() }
      });
      setBaseline(values);
      onChanged(values);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      data-track="staff.repairdetails.details.1"
      className="repair-action-item repair-information"
    >
      <button
        data-track="staff.repairdetails.summary.2"
        type="button"
        className="repair-tool-trigger"
        aria-expanded={tool.open}
        aria-controls={panelId}
        onClick={tool.toggle}
      >
        修改工单信息
      </button>
      {tool.open && (
        <div className="repair-control-panel" id={panelId}>
          <Notice>{error}</Notice>
          <form
            data-track="staff.repairdetails.form.3"
            className="field-form"
            ref={tool.form}
            onSubmit={async (event) => {
              event.preventDefault();
              if (await save()) tool.finish();
            }}
          >
            {fieldGroups.map((group) => (
              <fieldset className="repair-information-group" key={group.title}>
                <legend>{group.title}</legend>
                <div className="repair-information-fields">
                  {group.keys
                    .filter(
                      (key) =>
                        (key !== 'note' || !!item.original) &&
                        (key !== 'liquidMetal' || questions.liquidMetal) &&
                        (key !== 'dellG15' || questions.dellG15)
                    )
                    .map((key) => [
                      key,
                      key === 'contactValue'
                        ? values.contactType === 'qq'
                          ? 'QQ 账号'
                          : values.contactType === 'wechat'
                            ? '微信账号'
                            : fields[key]
                        : fields[key]
                    ])
                    .map(([key, label]) => (
                      <label
                        key={key}
                        className={
                          ['faultType', 'issue', 'note'].includes(key)
                            ? 'repair-field-wide'
                            : undefined
                        }
                      >
                        {label}
                        {fieldOptions[key] ? (
                          <Select
                            data-track="staff.repairdetails.input.4"
                            value={values[key]}
                            required={key === 'faultType'}
                            disabled={busy}
                            onChange={(event) => changeField(key, event.target.value)}
                          >
                            <option value="">未填写</option>
                            {!fieldOptions[key].includes(values[key]) && values[key] && (
                              <option value={values[key]}>
                                {optionLabels[values[key]] || values[key]}
                              </option>
                            )}
                            {fieldOptions[key].map((option) => (
                              <option key={option} value={option}>
                                {optionLabels[option] || option}
                              </option>
                            ))}
                          </Select>
                        ) : ['issue', 'note'].includes(key) ? (
                          <textarea
                            data-track="staff.repairdetails.input.4"
                            rows={3}
                            maxLength={key === 'note' ? 500 : 10000}
                            disabled={busy}
                            value={values[key]}
                            onChange={(event) => changeField(key, event.target.value)}
                          />
                        ) : (
                          <input
                            data-track="staff.repairdetails.input.4"
                            type={key === 'phone' ? 'tel' : key === 'email' ? 'email' : 'text'}
                            required={['name', 'brand', 'faultType'].includes(key)}
                            readOnly={key === 'studentId'}
                            disabled={busy}
                            value={values[key]}
                            onChange={(event) => changeField(key, event.target.value)}
                          />
                        )}
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}
            <div className="repair-panel-actions">
              <button
                data-track="staff.repairdetails.cancel-information"
                type="button"
                disabled={busy}
                onClick={tool.cancel}
              >
                取消
              </button>
              <button
                data-track="staff.repairdetails.button.5"
                className="field-primary"
                disabled={busy}
              >
                {busy ? '正在保存…' : '保存工单信息'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
export function RepairCredential({
  item,
  onIssued
}: {
  item: Appointment;
  onIssued: (token: string) => void;
}) {
  const [reason, setReason] = useState(''),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [issuedToken, setIssuedToken] = useState(''),
    [copied, setCopied] = useState(false);
  const tool = useRepairTool('credential', {
    dirty: !!reason || verified || (!!issuedToken && !copied),
    busy,
    leaveMessage: issuedToken
      ? '新链接尚未复制，关闭后将无法再次查看。请返回复制或确认已交付；丢弃并继续会放弃本次新链接。'
      : '请返回工单点击“签发私人链接”，再复制并交付新链接；也可以丢弃本次填写后继续。',
    discard: () => {
      setReason('');
      setVerified(false);
      setError('');
      setIssuedToken('');
      setCopied(false);
    }
  });
  const panelId = useId();
  const issuedUrl = issuedToken
    ? new URL(
        `/#${new URLSearchParams({ appointment: item.id, access: issuedToken })}`,
        location.origin
      ).href
    : '';
  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setCopied(true);
    } catch {
      setError('复制失败，请手动复制上方链接并交付机主。');
    }
  }
  async function issue() {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ accessToken: string }>(
        `/api/appointments/${encodeURIComponent(item.id)}/credential`,
        { method: 'POST', body: { identityVerified: verified, reason } }
      );
      setReason('');
      setVerified(false);
      setIssuedToken(result.accessToken);
      setCopied(false);
      onIssued(result.accessToken);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!item.canRecoverCredential) return null;
  return (
    <section
      data-track="staff.repairdetails.details.6"
      className="repair-action-item repair-credential"
    >
      <button
        data-track="staff.repairdetails.summary.7"
        type="button"
        className="repair-tool-trigger"
        aria-expanded={tool.open}
        aria-controls={panelId}
        onClick={tool.toggle}
      >
        补发查询链接
      </button>
      {tool.open && (
        <div className="repair-control-panel" id={panelId}>
          <Notice>{error}</Notice>
          {issuedToken ? (
            <div className="field-form">
              <p>新链接已签发，原链接已失效。请复制并交付机主后关闭工单。</p>
              <label>
                新私人查询链接
                <input
                  data-track="staff.repairdetails.credential-url"
                  readOnly
                  value={issuedUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <Notice>{copied ? '已复制新链接，请交付机主。' : ''}</Notice>
              <div className="repair-panel-actions">
                <button
                  data-track="staff.repairdetails.copy-credential"
                  type="button"
                  onClick={() => void copy()}
                >
                  复制私人查询链接
                </button>
                <button
                  data-track="staff.repairdetails.finish-credential"
                  type="button"
                  className="field-primary"
                  onClick={() => tool.finish()}
                >
                  已交付，完成
                </button>
              </div>
            </div>
          ) : (
            <>
              <p>核验客户身份后补发，原链接立即失效。</p>
              <form
                data-track="staff.repairdetails.form.8"
                className="field-form"
                ref={tool.form}
                onSubmit={async (event) => {
                  event.preventDefault();
                  await issue();
                }}
              >
                <label className="field-check">
                  <input
                    data-track="staff.repairdetails.input.9"
                    type="checkbox"
                    required
                    disabled={busy}
                    checked={verified}
                    onChange={(event) => setVerified(event.target.checked)}
                  />
                  <span>已人工核验机主身份</span>
                </label>
                <label>
                  核验说明（勿录入完整联系方式）
                  <textarea
                    data-track="staff.repairdetails.textarea.10"
                    required
                    minLength={8}
                    maxLength={300}
                    disabled={busy}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="repair-panel-actions">
                  <button
                    data-track="staff.repairdetails.cancel-credential"
                    type="button"
                    disabled={busy}
                    onClick={tool.cancel}
                  >
                    取消
                  </button>
                  <button
                    data-track="staff.repairdetails.button.11"
                    className="field-primary"
                    disabled={busy || !verified}
                  >
                    {busy ? '正在签发…' : '签发私人链接'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}
const actions = {
  'repairs.started': '接单',
  'repairs.received': '首次接收',
  'repairs.transferred': '设备交接',
  'repairs.completed': '结束服务',
  'repairs.corrected': '更正结果',
  'repairs.information.updated': '更正资料',
  'repairs.photos.supplemented': '补传首次接收照片',
  'repairs.linked': '关联返修',
  'repairs.workflow.archived': '旧流程迁移存档',
  'repairs.followup.migrated': '旧返修申请存档'
};
const historyFields = {
  status: '服务状态',
  outcome: '维修结果',
  repairNote: '处理说明',
  assignedTo: '主修账号',
  brand: '品牌',
  deviceModel: '型号',
  deviceType: '设备类型',
  serial: '设备序列号',
  warranty: '是否在保',
  liquidMetal: '是否使用液金散热',
  dellG15: 'Dell G15 / G16 系列',
  liquidDrop: '进水情况',
  name: '姓名',
  college: '学院',
  note: '登记备注',
  contactType: '预约联系方式类型',
  faultType: '故障类型',
  issue: '故障描述',
  parentAppointmentId: '关联原单',
  photoDeferredBy: '照片待传经办人'
};
export function RepairHistory({ history }: { history: Appointment['repairHistory'] }) {
  const [open, setOpen] = useState(false);
  const tools = useRepairTools();
  if (!history?.events) return null;
  return (
    <>
      <button
        data-track="staff.repairdetails.button.12"
        type="button"
        className="repair-tool-trigger"
        onClick={() => (tools ? tools.request(null, () => setOpen(true)) : setOpen(true))}
      >
        查看维修与交接记录
      </button>
      {open && (
        <Modal title="维修与交接历史" onClose={() => setOpen(false)}>
          {!history.events.length && <p className="field-muted">暂无操作记录。</p>}
          <div className="repair-history-list">
            {history?.events?.map((event, index) => {
              const before = (event.before || {}) as Record<string, unknown>,
                after = (event.after || {}) as Record<string, unknown>;
              const display = (key: string, value: unknown) =>
                String(
                  (key === 'outcome'
                    ? outcomeLabels[String(value)]
                    : key === 'status'
                      ? statusLabels[String(value)]
                      : value) || '—'
                );
              return (
                <article key={index} className="repair-history-event">
                  <p>
                    {formatInstant(event.occurredAt)} · {actions[event.action] || event.action} ·{' '}
                    {event.actorName || ''} {event.reason}
                  </p>
                  {Object.entries(historyFields)
                    .filter(([key]) => key in after && before[key] !== after[key])
                    .map(([key, label]) => (
                      <p key={key}>
                        {label}：{display(key, before[key])} → {display(key, after[key])}
                      </p>
                    ))}
                  {['phone', 'email', 'social', 'contactValue'].some(
                    (key) => key in after && before[key] !== after[key]
                  ) && <p>联系方式已更正（访问详情可查看当前值）</p>}
                </article>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
