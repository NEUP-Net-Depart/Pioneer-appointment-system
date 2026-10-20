import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { addDays, dateKey, formatInstant } from '../../shared/time.js';
import { request } from './request.js';
import { ActivityContext, Modal, Notice } from './field/ui';
import { useUnsavedChanges } from './useUnsavedChanges.js';

export function ServiceLocationEditor({ campus }) {
  const active = useContext(ActivityContext);
  const [date, setDate] = useState(dateKey()),
    [snapshot, setSnapshot] = useState(null),
    [drafts, setDrafts] = useState({});
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false);
  const reading = useRef(null),
    lock = useRef(false);
  const key = `${campus}/${date}`,
    data = snapshot?.key === key ? snapshot : null,
    draft = drafts[key];
  const value = draft?.value ?? data?.location ?? '',
    conflict = !!draft && !!data && draft.revision !== data.revision;
  const refresh = useCallback(async () => {
    if (!active || !date || document.hidden || lock.current) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    setError('');
    try {
      const [result, details] = await Promise.all([
        request(`/api/service-locations?${new URLSearchParams({ dateFrom: date, dateTo: date })}`, {
          signal: controller.signal
        }),
        request(`/api/service-locations/history?${new URLSearchParams({ campus, date })}`, {
          signal: controller.signal
        })
      ]);
      if (controller.signal.aborted) return;
      const item = result.items.find((item) => item.campus === campus) || {
        location: '',
        revision: 0
      };
      setSnapshot({ ...item, ...details, key });
      setDrafts((current) => {
        if (!current[key] || current[key].value !== item.location) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (failure) {
      if (!controller.signal.aborted) {
        if ([401, 403].includes(failure.status)) {
          setSnapshot(null);
          setDrafts({});
          setReview(false);
        }
        setError(failure.message);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [active, campus, date, key]);
  useEffect(() => {
    refresh();
    const visibility = () => {
      if (document.hidden) {
        reading.current?.abort();
        setLoading(false);
      } else refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      reading.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refresh]);
  useEffect(() => {
    setReview(false);
    setMessage('');
  }, [active, key]);
  useUnsavedChanges({
    dirty: !!Object.keys(drafts).length,
    active,
    busy,
    save: () => save(true),
    discard: () => {
      setDrafts({});
      setReview(false);
      setError('');
    }
  });
  function edit(value) {
    setDrafts((current) => {
      const next = { ...current };
      if (value === data.location) delete next[key];
      else next[key] = { revision: data.revision, original: data.location, ...next[key], value };
      return next;
    });
    setMessage('');
  }
  async function save(all = false) {
    if (lock.current || (all !== true && (!data || !draft || conflict))) return;
    lock.current = true;
    reading.current?.abort();
    setBusy(true);
    setLoading(false);
    setError('');
    try {
      for (const [savedKey, entry] of all === true ? Object.entries(drafts) : [[key, draft]]) {
        const [savedCampus, savedDate] = savedKey.split('/');
        const result = await request('/api/service-locations', {
          method: 'PATCH',
          body: {
            campus: savedCampus,
            date: savedDate,
            location: entry.value.trim(),
            revision: entry.revision
          }
        });
        if (savedKey === key) setSnapshot({ ...result, key });
        setDrafts((current) => {
          const next = { ...current };
          delete next[savedKey];
          return next;
        });
      }
      setMessage('已保存。已有预约同步显示最新地点；需要时请人工通知客户。');
      return true;
    } catch (failure) {
      lock.current = false;
      await refresh();
      setError(
        failure.status === 409
          ? '地点已被其他人修改，请核对最新地点和你的草稿。'
          : `${failure.message}。已核对保存结果，未确认的输入仍保留。`
      );
    } finally {
      lock.current = false;
      setBusy(false);
      setReview(false);
    }
  }
  return (
    <section className="field-card capacity-locations" aria-label="维修地点设置">
      <div className="capacity-section-heading">
        <div>
          <h2>维修地点</h2>
          <p className="field-muted">按校区和日期设置；预约页面和已有预约都会显示最新地点。</p>
        </div>
        <button disabled={loading || busy || !date} onClick={refresh}>
          {loading ? '正在读取…' : '读取最新地点'}
        </button>
      </div>
      <div className="capacity-location-dates">
        <label>
          维修日期
          <input
            type="date"
            value={date}
            disabled={busy}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <div className="capacity-location-days">
          {[0, 1, 2, 3].map((offset) => {
            const day = addDays(dateKey(), offset);
            return (
              <button
                key={day}
                disabled={busy}
                aria-pressed={date === day}
                onClick={() => setDate(day)}
              >
                {offset === 0 ? '今天' : day.slice(5).replace('-', '/')}
              </button>
            );
          })}
        </div>
      </div>
      <Notice>{error}</Notice>
      <p className="workspace-update" role="status">
        {message ||
          (loading
            ? '正在读取，保留未保存输入…'
            : Object.keys(drafts).length
              ? '切换日期和校区保留草稿；离开前请保存。'
              : '')}
      </p>
      <form
        className="capacity-location-form"
        onSubmit={(event) => {
          event.preventDefault();
          setReview(true);
        }}
      >
        <label>
          具体维修地点
          <textarea
            aria-label="具体维修地点"
            rows={3}
            maxLength={200}
            placeholder="例如：图书馆一楼服务区"
            value={value}
            disabled={!data || busy}
            onChange={(event) => edit(event.target.value)}
          />
        </label>
        <p className="field-muted">
          尚无预约时可留空以暂停新预约；已有预约的日期需保留地点。修改后请按需人工通知客户。
        </p>
        {conflict && (
          <div className="capacity-location-conflict">
            <strong>最新地点</strong>
            <p>{data.location || '未设置'}</p>
            <p className="field-muted">你的输入保留在上方；确认后可重新保存。</p>
            <div className="field-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDrafts((current) => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                  })
                }
              >
                使用最新地点
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: { ...current[key], original: data.location, revision: data.revision }
                  }))
                }
              >
                保留我的修改
              </button>
            </div>
          </div>
        )}
        <div className="field-actions">
          <button
            type="button"
            disabled={busy || !draft}
            onClick={() =>
              setDrafts((current) => {
                const next = { ...current };
                delete next[key];
                return next;
              })
            }
          >
            撤销修改
          </button>
          <button className="field-primary" disabled={busy || !data || !draft || conflict}>
            检查并保存地点
          </button>
        </div>
      </form>
      {data && (
        <details className="capacity-location-details">
          <summary>受影响预约与修改记录</summary>
          <p>
            {data.affectedAppointments?.length || 0} 条进行中的预约会使用此地点；请按需人工通知。
          </p>
          {!!data.affectedAppointments?.length && (
            <ul>
              {data.affectedAppointments.map((item) => (
                <li key={item.id}>
                  <strong>{item.id}</strong>
                  {[item.name, item.contactValue || item.social || item.phone, item.email]
                    .filter(Boolean)
                    .map((text, index) => (
                      <span key={index}>{text}</span>
                    ))}
                </li>
              ))}
            </ul>
          )}
          {data.changes?.length ? (
            data.changes.map((item) => (
              <p key={item.revision}>
                {formatInstant(item.createdAt)} · {item.beforeLocation || '未设置'} →{' '}
                {item.afterLocation || '未设置'}
              </p>
            ))
          ) : (
            <p className="field-muted">暂无修改记录。</p>
          )}
        </details>
      )}
      {review && (
        <Modal title="确认修改维修地点" dismissible={!busy} onClose={() => setReview(false)}>
          <p>
            {campus}校区 · {date}
          </p>
          <p>
            {draft?.original || '未设置'} → <strong>{value.trim() || '未设置，暂停新预约'}</strong>
          </p>
          <p>
            已有预约将同步显示新地点，{data?.affectedAppointments?.length || 0}{' '}
            条进行中的预约需要按需通知。
          </p>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setReview(false)}>
              返回编辑
            </button>
            <button className="field-primary" disabled={busy || conflict} onClick={save}>
              {busy ? '正在保存…' : '确认保存地点'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
