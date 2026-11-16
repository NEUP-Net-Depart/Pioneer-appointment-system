import { Select, DateTimePicker } from './SelectionControls.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useRef, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { formatInstant } from '../../shared/time.js';
import { DataExpansion } from './DataExpansion.jsx';
import { TimePicker } from './TimePicker.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { HelpHint } from './HelpHint';

// datetime-local always represents Shanghai here, regardless of device timezone.
const localTime = (value) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
const isoTime = (value) => new Date(`${value}:00+08:00`).toISOString();

export function BookingSettingsEditor({ campus, editorRef, mode = 'release', onManageSuspension }) {
  const active = useContext(ActivityContext);
  const client = useQueryClient();
  const [releaseTime, setReleaseTime] = useState(null);
  const releaseRevision = useRef(null);
  const queryKey = ['/api/booking-settings/manage', { campus }];
  const result = useQuery({ queryKey, enabled: active });
  const data = result.data;
  const loading = result.isPending;
  const [editing, setEditing] = useState(null),
    [original, setOriginal] = useState(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false),
    attempt = useRef(null);
  const timeDirty = !!data && releaseTime !== null && releaseTime !== data.settings.releaseTime;
  const noticeDirty = !!editing && JSON.stringify(editing) !== JSON.stringify(original);
  async function persist(kind, value) {
    const fingerprint = JSON.stringify([kind, value]);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const result = await request(
      kind === 'settings' ? '/api/booking-settings' : '/api/booking-notices',
      {
        method: 'PATCH',
        body: { ...value, requestId: attempt.current.requestId }
      }
    );
    attempt.current = null;
    await client.cancelQueries({ queryKey });
    await client.invalidateQueries({ queryKey, refetchType: 'none' });
    return result;
  }
  async function saveTime() {
    const result = await persist('settings', {
      campus,
      revision: releaseRevision.current ?? data.settings.revision,
      releaseTime
    });
    client.setQueryData(queryKey, (current) => ({ ...current, settings: result }));
    releaseRevision.current = null;
    setReleaseTime(null);
    setMessage('放号时间已保存。');
  }
  async function saveNotice() {
    const result = await persist('notice', {
      ...editing,
      campus,
      startsAt: isoTime(editing.startsAt),
      endsAt: isoTime(editing.endsAt)
    });
    client.setQueryData(queryKey, (current) => ({
      ...current,
      notices: [result, ...current.notices.filter((item) => item.id !== result.id)]
    }));
    setEditing(null);
    setOriginal(null);
    setMessage(result.enabled ? '公告已保存。' : '公告已保存为停用状态。');
  }
  async function perform(operation) {
    if (lock.current) throw new Error('正在保存，请稍后再试。');
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      return true;
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        client.setQueryData(queryKey, null);
        setEditing(null);
      }
      setError(error.message);
      throw error;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function discard() {
    setReleaseTime(null);
    releaseRevision.current = null;
    setEditing(null);
    setOriginal(null);
    attempt.current = null;
    setError('');
  }
  const form = useUnsavedChanges({
    dirty: timeDirty || noticeDirty,
    active,
    busy,
    save: () =>
      perform(async () => {
        if (noticeDirty) await saveNotice();
        if (timeDirty) await saveTime();
      }),
    discard
  });
  if (editorRef)
    editorRef.current = {
      dirty: timeDirty || noticeDirty,
      busy,
      save: () =>
        perform(async () => {
          if (noticeDirty) await saveNotice();
          if (timeDirty) await saveTime();
        }),
      discard
    };
  function openNotice(item) {
    const value = item
      ? {
          ...item,
          displayMode: item.displayMode || 'inline',
          startsAt: localTime(item.startsAt),
          endsAt: localTime(item.endsAt)
        }
      : {
          id: crypto.randomUUID(),
          campus,
          revision: -1,
          title: '',
          content: '',
          important: false,
          displayMode: 'inline',
          enabled: true,
          startsAt: localTime(new Date().toISOString()),
          endsAt: localTime(new Date(Date.now() + 7 * 86400000).toISOString())
        };
    setOriginal(value);
    setEditing(value);
    setError('');
  }
  const update = (key, value) => setEditing((current) => ({ ...current, [key]: value }));
  const refreshControl = (
    <RefreshButton
      data-track="staff.bookingsettingseditor.button.1"
      key={`${campus}:${mode}`}
      disabled={busy || timeDirty || noticeDirty}
      label={mode === 'release' ? '刷新放号规则' : '刷新公告'}
      compactOnMobile={mode === 'release'}
      onRefresh={() => {
        setError('');
        setMessage('');
        return result.refetch({ throwOnError: true });
      }}
    />
  );
  return (
    <div className="booking-settings-editor" aria-busy={loading}>
      <Notice>{error || result.error?.message || message}</Notice>
      {error && !editing && (
        <button
          data-track="staff.bookingsettingseditor.button.2"
          disabled={busy || loading}
          onClick={() => {
            discard();
            result.refetch();
          }}
        >
          丢弃修改并读取最新配置
        </button>
      )}
      <>
        {mode === 'release' && (
          <section className="field-card booking-rule-card">
            <div className="capacity-section-heading">
              <h2>每日放号</h2>
              {refreshControl}
            </div>
            <form
              data-track="staff.bookingsettingseditor.form.3"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(saveTime).catch(() => {});
              }}
            >
              <label>
                放号时间（北京时间）
                <TimePicker
                  data-track="staff.bookingsettingseditor.input.4"
                  label="选择放号时间"
                  data-motion-value="field"
                  required
                  value={data ? (releaseTime ?? data.settings.releaseTime) : ''}
                  disabled={busy || !data}
                  onChange={(value) => {
                    releaseRevision.current ??= data.settings.revision;
                    setReleaseTime(value);
                  }}
                />
              </label>
              <div className="field-actions">
                <button
                  data-track="staff.bookingsettingseditor.button.5"
                  className="field-primary"
                  disabled={busy || !timeDirty}
                >
                  {busy ? '正在保存…' : '保存放号时间'}
                </button>
                <HelpHint data-track="staff.bookingsettingseditor.helphint.20" label="放号规则">
                  放号前可约当天至后两天；放号后可约当天至后三天。仅开放周一至周四的未结束时段。签到、排班和统计仍按北京时间自然日计算。
                </HelpHint>
              </div>
            </form>
          </section>
        )}
        {mode === 'notices' && (
          <section className="field-card booking-rule-card">
            <div className="capacity-section-heading">
              <div className="booking-section-title">
                <h2>校区公告</h2>
                <HelpHint data-track="staff.bookingsettingseditor.helphint.21" label="公告展示规则">
                  公告仅在预约首页展示，可选页面或弹窗形式；必读公告需点击阅读确认后才能进入下一步。时间均为北京时间。
                </HelpHint>
              </div>
              <div className="field-actions">
                {refreshControl}
                <button
                  data-track="staff.bookingsettingseditor.button.6"
                  className="field-primary"
                  disabled={busy || !data}
                  onClick={() => openNotice()}
                >
                  新增公告
                </button>
              </div>
            </div>
            <DataExpansion ready={!!data}>
              {!data ? null : !data.notices.length ? (
                <p className="field-muted">暂无公告。</p>
              ) : (
                <div className="booking-notice-list">
                  {data.notices.map((item) => (
                    <article data-motion-item="" key={item.id}>
                      <div>
                        <strong data-motion-value="text">{item.title}</strong>
                        <span data-motion-value="text" className="booking-notice-meta">
                          {item.important ? '必读公告' : '普通公告'} ·{' '}
                          {item.displayMode === 'modal' ? '弹窗展示' : '页面展示'} ·{' '}
                          {!item.enabled
                            ? '已停用'
                            : Date.now() < Date.parse(item.startsAt)
                              ? '待生效'
                              : Date.now() >= Date.parse(item.endsAt)
                                ? '已结束'
                                : '展示中'}
                        </span>
                        <p data-motion-value="text">{item.content}</p>
                        <small data-motion-value="text">
                          {formatInstant(item.startsAt)} 至 {formatInstant(item.endsAt)}
                        </small>
                      </div>
                      <button
                        data-track="staff.bookingsettingseditor.button.7"
                        onClick={() => openNotice(item)}
                      >
                        编辑公告
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </DataExpansion>
          </section>
        )}
        {mode === 'notices' && (
          <section className="field-card booking-rule-card">
            <div className="capacity-section-heading">
              <h2>暂停维修公告</h2>
              <button
                data-track="staff.bookingsettingseditor.button.8"
                onClick={onManageSuspension}
              >
                管理暂停日期
              </button>
            </div>
            <DataExpansion ready={!!data}>
              {!data ? null : !data.suspensions?.length ? (
                <p className="field-muted">暂无待生效或当日的暂停维修公告。</p>
              ) : (
                <div className="booking-notice-list">
                  {data.suspensions.map((item) => (
                    <article data-motion-item="" key={item.id}>
                      <div>
                        <strong data-motion-value="text">
                          {item.businessDate} · {campus}校区暂停维修
                        </strong>
                        <span data-motion-value="text" className="booking-notice-meta">
                          {item.businessDate >
                          new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
                            ? '即将暂停'
                            : '今日暂停'}{' '}
                          · 来自暂停安排
                        </span>
                        <p data-motion-value="text">{item.content}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </DataExpansion>
          </section>
        )}
      </>
      {editing && (
        <Modal
          title={editing.revision < 0 ? '新增校区公告' : '编辑校区公告'}
          onClose={() => {
            if (!busy && !noticeDirty) {
              setEditing(null);
              setOriginal(null);
            } else if (!busy) setError('公告尚未保存，请保存或使用“放弃编辑”。');
          }}
        >
          <form
            data-track="staff.bookingsettingseditor.form.9"
            ref={form}
            className="booking-notice-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(saveNotice).catch(() => {});
            }}
          >
            <p data-motion-value="text" className="field-muted">
              {campus}校区
            </p>
            <label>
              公告标题
              <input
                data-track="staff.bookingsettingseditor.input.10"
                required
                maxLength={80}
                value={editing.title}
                disabled={busy || !data}
                onChange={(event) => update('title', event.target.value)}
              />
            </label>
            <label>
              公告内容
              <textarea
                data-track="staff.bookingsettingseditor.textarea.11"
                required
                maxLength={2000}
                rows={5}
                value={editing.content}
                disabled={busy || !data}
                onChange={(event) => update('content', event.target.value)}
              />
            </label>
            <div className="booking-notice-times">
              <label>
                开始时间（北京时间）
                <DateTimePicker
                  data-track="staff.bookingsettingseditor.input.12"
                  label="开始时间"
                  required
                  value={editing.startsAt}
                  disabled={busy || !data}
                  onChange={(event) => update('startsAt', event.target.value)}
                />
              </label>
              <label>
                结束时间（北京时间）
                <DateTimePicker
                  data-track="staff.bookingsettingseditor.input.13"
                  label="结束时间"
                  required
                  min={editing.startsAt}
                  value={editing.endsAt}
                  disabled={busy || !data}
                  onChange={(event) => update('endsAt', event.target.value)}
                />
              </label>
            </div>
            <label>
              展示方式
              <Select
                data-track="staff.bookingsettingseditor.select.14"
                value={editing.displayMode}
                disabled={busy || !data}
                onChange={(event) => update('displayMode', event.target.value)}
              >
                <option value="inline">页面展示</option>
                <option value="modal">弹窗展示</option>
              </Select>
            </label>
            <label className="booking-setting-check">
              <input
                data-track="staff.bookingsettingseditor.input.15"
                type="checkbox"
                checked={editing.important}
                disabled={busy || !data}
                onChange={(event) => update('important', event.target.checked)}
              />
              <span>必读公告</span>
            </label>
            <label className="booking-setting-check">
              <input
                data-track="staff.bookingsettingseditor.input.16"
                type="checkbox"
                checked={editing.enabled}
                disabled={busy || !data}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span>启用公告</span>
            </label>
            <Notice>{error}</Notice>
            {error && (
              <button
                data-track="staff.bookingsettingseditor.button.17"
                type="button"
                disabled={busy || !data}
                onClick={() => {
                  discard();
                  result.refetch();
                }}
              >
                丢弃修改并读取最新配置
              </button>
            )}
            <div className="field-actions">
              <button
                data-track="staff.bookingsettingseditor.button.18"
                type="button"
                disabled={busy || !data}
                onClick={() => {
                  setEditing(null);
                  setOriginal(null);
                  setError('');
                }}
              >
                放弃编辑
              </button>
              <button
                data-track="staff.bookingsettingseditor.button.19"
                className="field-primary"
                disabled={busy || !data}
              >
                {busy ? '正在保存…' : '保存公告'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
