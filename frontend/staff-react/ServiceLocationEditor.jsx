import { DatePicker } from './SelectionControls.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { addDays, dateKey, formatInstant } from '../../shared/time.js';
import { request } from './request.js';
import { ActivityContext, Modal, Notice } from './field/ui';
import { useUnsavedChanges } from './useUnsavedChanges.js';

export function ServiceLocationEditor({ campus }) {
  const active = useContext(ActivityContext);
  const historyId = useId();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [date, setDate] = useState(dateKey()),
    [drafts, setDrafts] = useState({});
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false);
  const client = useQueryClient();
  const lock = useRef(false);
  const key = `${campus}/${date}`;
  const locations = useQuery({
    queryKey: ['/api/service-locations', { dateFrom: date, dateTo: date }],
    enabled: active && !!date
  });
  const history = useQuery({
    queryKey: ['/api/service-locations/history', { campus, date }],
    enabled: active && !!date
  });
  const data =
    locations.data && history.data
      ? {
          ...(locations.data.items.find((item) => item.campus === campus) || {
            location: '',
            revision: 0
          }),
          ...history.data
        }
      : null;
  const loading = locations.isPending || history.isPending;
  const draft = drafts[key];
  const refresh = () => Promise.all([locations.refetch(), history.refetch()]);
  const value = draft?.value ?? data?.location ?? '',
    conflict = !!draft && !!data && draft.revision !== data.revision;
  useEffect(() => {
    if (!locations.data) return;
    const location = locations.data.items.find((item) => item.campus === campus)?.location || '';
    setDrafts((current) => {
      if (!current[key] || current[key].value !== location) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [locations.data, campus, key]);
  useEffect(() => {
    setReview(false);
    setHistoryOpen(false);
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
    await Promise.all(
      ['/api/service-locations', '/api/service-locations/history'].map((path) =>
        client.cancelQueries({ queryKey: [path] })
      )
    );
    setBusy(true);
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
        client.setQueriesData(
          { queryKey: ['/api/service-locations'] },
          (current) =>
            current && {
              ...current,
              items: current.items.map((item) =>
                item.campus === savedCampus && item.date === savedDate ? result : item
              )
            }
        );
        setDrafts((current) => {
          const next = { ...current };
          delete next[savedKey];
          return next;
        });
      }
      const affectedQueries = {
        predicate: (query) =>
          [
            '/api/service-locations',
            '/api/service-locations/history',
            '/api/appointments',
            '/api/appointments/overview',
            '/api/field/home',
            '/api/field/board'
          ].includes(query.queryKey[0])
      };
      await client.cancelQueries(affectedQueries);
      await client.invalidateQueries(affectedQueries);
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
        </div>
        <RefreshButton
          key={`${campus}:${date}`}
          disabled={busy || !date}
          onRefresh={refresh}
          label="刷新维修地点"
          compactOnMobile
        />
      </div>
      <div className="capacity-location-dates">
        <label>
          维修日期
          <DatePicker
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
      <Notice>{error || locations.error?.message || history.error?.message}</Notice>
      <Notice>{message}</Notice>
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
            <p data-motion-value="text">{data.location || '未设置'}</p>
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
        <section className="capacity-location-history" aria-label="受影响预约与修改记录">
          <p data-motion-value="number">
            {data.affectedAppointments?.length || 0} 条进行中的预约会使用此地点；请按需人工通知。
          </p>
          <button
            type="button"
            aria-expanded={historyOpen}
            aria-controls={historyId}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {historyOpen ? '收起相关记录' : '查看受影响预约与修改记录'}
          </button>
          {historyOpen && (
            <div id={historyId} className="capacity-location-records">
              {!!data.affectedAppointments?.length && (
                <section aria-label="受影响预约">
                  <h4>受影响预约</h4>
                  <ul>
                    {data.affectedAppointments.map((item) => (
                      <li data-motion-item="" key={item.id}>
                        <strong data-motion-value="text">{item.id}</strong>
                        {[item.name, item.contactValue || item.social || item.phone, item.email]
                          .filter(Boolean)
                          .map((text, index) => (
                            <span data-motion-value="text" key={index}>
                              {text}
                            </span>
                          ))}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-label="地点修改记录">
                <h4>地点修改记录</h4>
                {data.changes?.length ? (
                  <ul>
                    {data.changes.map((item) => (
                      <li data-motion-value="text" key={item.revision}>
                        {formatInstant(item.createdAt)} · {item.beforeLocation || '未设置'} →{' '}
                        {item.afterLocation || '未设置'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-muted">暂无修改记录。</p>
                )}
              </section>
            </div>
          )}
        </section>
      )}
      {review && (
        <Modal title="确认修改维修地点" dismissible={!busy} onClose={() => setReview(false)}>
          <p data-motion-value="text">
            {campus}校区 · {date}
          </p>
          <p>
            {draft?.original || '未设置'} →{' '}
            <strong data-motion-value="text">{value.trim() || '未设置，暂停新预约'}</strong>
          </p>
          <p data-motion-value="number">
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
