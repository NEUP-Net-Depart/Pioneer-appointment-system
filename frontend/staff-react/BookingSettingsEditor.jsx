import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { formatInstant } from '../../shared/time.js';

// datetime-local always represents Shanghai here, regardless of device timezone.
const localTime = (value) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
const isoTime = (value) => new Date(`${value}:00+08:00`).toISOString();

export function BookingSettingsEditor({ campus, editorRef, mode = 'release', onManageSuspension }) {
  const active = useContext(ActivityContext);
  const [data, setData] = useState(null),
    [releaseTime, setReleaseTime] = useState('10:00');
  const [editing, setEditing] = useState(null),
    [original, setOriginal] = useState(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const lock = useRef(false),
    attempt = useRef(null),
    loaded = useRef(false),
    draftDirty = useRef(false);
  const timeDirty = !!data && releaseTime !== data.settings.releaseTime;
  const noticeDirty = !!editing && JSON.stringify(editing) !== JSON.stringify(original);
  draftDirty.current = timeDirty || noticeDirty;
  useEffect(() => {
    if (!active) {
      loaded.current = false;
      return;
    }
    let controller;
    function read() {
      if (document.hidden || loaded.current || controller || draftDirty.current) return;
      const current = new AbortController();
      controller = current;
      setLoading(true);
      request('/api/booking-settings/manage?' + new URLSearchParams({ campus }), {
        signal: current.signal
      })
        .then((result) => {
          if (current.signal.aborted || draftDirty.current) return;
          setData(result);
          setReleaseTime(result.settings.releaseTime);
          loaded.current = true;
        })
        .catch((error) => {
          if (current.signal.aborted) return;
          if ([401, 403].includes(error.status)) {
            setData(null);
            setEditing(null);
          }
          setError(error.message);
        })
        .finally(() => {
          if (controller === current) {
            controller = null;
            setLoading(false);
          }
        });
    }
    const visibility = () => {
      if (document.hidden) {
        controller?.abort();
        controller = null;
        setLoading(false);
      } else read();
    };
    read();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, campus, retry]);

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
    return result;
  }
  async function saveTime() {
    const result = await persist('settings', {
      campus,
      revision: data.settings.revision,
      releaseTime
    });
    setData((current) => ({ ...current, settings: result }));
    setMessage('放号时间已保存，新预约立即使用此规则。已有预约保留。');
  }
  async function saveNotice() {
    const result = await persist('notice', {
      ...editing,
      campus,
      startsAt: isoTime(editing.startsAt),
      endsAt: isoTime(editing.endsAt)
    });
    setData((current) => ({
      ...current,
      notices: [result, ...current.notices.filter((item) => item.id !== result.id)]
    }));
    setEditing(null);
    setOriginal(null);
    setMessage(
      result.enabled ? '公告已保存，将在设定的北京时间范围内展示。' : '公告已保存为停用状态。'
    );
  }
  async function perform(operation) {
    if (lock.current) throw new Error('正在保存，请稍后再试。');
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        setData(null);
        setEditing(null);
        loaded.current = false;
      }
      setError(error.message);
      throw error;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function discard() {
    if (data) setReleaseTime(data.settings.releaseTime);
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
  return (
    <div className="booking-settings-editor" aria-busy={loading}>
      <div className="field-actions">
        <button
          disabled={busy || loading || timeDirty || noticeDirty}
          onClick={() => {
            setError('');
            setMessage('');
            loaded.current = false;
            setRetry((value) => value + 1);
          }}
        >
          读取最新规则
        </button>
      </div>
      <Notice>{error || message}</Notice>
      {!data && <p role="status">{loading ? '正在读取预约规则…' : '暂时无法读取预约规则。'}</p>}
      {error && !editing && (
        <button
          disabled={busy || loading}
          onClick={() => {
            discard();
            loaded.current = false;
            setRetry((value) => value + 1);
          }}
        >
          丢弃修改并读取最新配置
        </button>
      )}
      {data && (
        <>
          {mode === 'release' && (
            <section className="field-card booking-rule-card">
              <div>
                <h2>每日放号</h2>
                <p>仅调整预约窗口的切换时间；签到、排班和统计仍按北京时间自然日计算。</p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(saveTime).catch(() => {});
                }}
              >
                <label>
                  放号时间（北京时间）
                  <input
                    type="time"
                    required
                    value={releaseTime}
                    disabled={busy}
                    onChange={(event) => setReleaseTime(event.target.value)}
                  />
                </label>
                <p className="field-muted">
                  放号前可约当天至后两天；放号后可约当天至后三天。仅开放周一至周四的未结束时段。
                </p>
                <div className="field-actions">
                  <button className="field-primary" disabled={busy || !timeDirty}>
                    {busy ? '正在保存…' : '保存放号时间'}
                  </button>
                </div>
              </form>
            </section>
          )}
          {mode === 'notices' && (
            <section className="field-card booking-rule-card">
              <div className="capacity-section-heading">
                <div>
                  <h2>校区公告</h2>
                  <p>
                    公告仅在预约首页展示，可选页面或弹窗形式；必读公告需点击阅读确认后才能进入下一步。时间均为北京时间。
                  </p>
                </div>
                <button className="field-primary" disabled={busy} onClick={() => openNotice()}>
                  新增公告
                </button>
              </div>
              {!data.notices.length ? (
                <p className="field-muted">暂无公告。可发布维修安排、到场须知等说明。</p>
              ) : (
                <div className="booking-notice-list">
                  {data.notices.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span className="booking-notice-meta">
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
                        <p>{item.content}</p>
                        <small>
                          {formatInstant(item.startsAt)} 至 {formatInstant(item.endsAt)}
                        </small>
                      </div>
                      <button onClick={() => openNotice(item)}>编辑公告</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {mode === 'notices' && (
            <section className="field-card booking-rule-card">
              <div className="capacity-section-heading">
                <div>
                  <h2>暂停维修公告</h2>
                  <p>
                    与暂停日期同步，无需重复发布；恢复维修或日期结束后自动停止展示。用户选中对应日期时会看到暂停说明。
                  </p>
                </div>
                <button onClick={onManageSuspension}>管理暂停日期</button>
              </div>
              {!data.suspensions?.length ? (
                <p className="field-muted">暂无待生效或当日的暂停维修公告。</p>
              ) : (
                <div className="booking-notice-list">
                  {data.suspensions.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>
                          {item.businessDate} · {campus}校区暂停维修
                        </strong>
                        <span className="booking-notice-meta">
                          {item.businessDate >
                          new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
                            ? '即将暂停'
                            : '今日暂停'}{' '}
                          · 来自暂停安排
                        </span>
                        <p>{item.content}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
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
            ref={form}
            className="booking-notice-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(saveNotice).catch(() => {});
            }}
          >
            <p className="field-muted">{campus}校区 · 保存后按生效时间自动展示或结束</p>
            <label>
              公告标题
              <input
                required
                maxLength={80}
                value={editing.title}
                disabled={busy}
                onChange={(event) => update('title', event.target.value)}
              />
            </label>
            <label>
              公告内容
              <textarea
                required
                maxLength={2000}
                rows={5}
                value={editing.content}
                disabled={busy}
                onChange={(event) => update('content', event.target.value)}
              />
            </label>
            <div className="booking-notice-times">
              <label>
                开始时间（北京时间）
                <input
                  required
                  type="datetime-local"
                  value={editing.startsAt}
                  disabled={busy}
                  onChange={(event) => update('startsAt', event.target.value)}
                />
              </label>
              <label>
                结束时间（北京时间）
                <input
                  required
                  type="datetime-local"
                  min={editing.startsAt}
                  value={editing.endsAt}
                  disabled={busy}
                  onChange={(event) => update('endsAt', event.target.value)}
                />
              </label>
            </div>
            <label>
              展示方式
              <select
                value={editing.displayMode}
                disabled={busy}
                onChange={(event) => update('displayMode', event.target.value)}
              >
                <option value="inline">页面展示</option>
                <option value="modal">弹窗展示</option>
              </select>
            </label>
            <label className="booking-setting-check">
              <input
                type="checkbox"
                checked={editing.important}
                disabled={busy}
                onChange={(event) => update('important', event.target.checked)}
              />
              <span>必读公告，进入下一步前需点击阅读确认</span>
            </label>
            <label className="booking-setting-check">
              <input
                type="checkbox"
                checked={editing.enabled}
                disabled={busy}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span>启用公告</span>
            </label>
            <Notice>{error}</Notice>
            {error && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  discard();
                  loaded.current = false;
                  setRetry((value) => value + 1);
                }}
              >
                丢弃修改并读取最新配置
              </button>
            )}
            <div className="field-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setOriginal(null);
                  setError('');
                }}
              >
                放弃编辑
              </button>
              <button className="field-primary" disabled={busy}>
                {busy ? '正在保存…' : '保存公告'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
