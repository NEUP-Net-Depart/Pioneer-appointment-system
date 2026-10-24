import { DataValue } from './DataValue';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';
import { addDays, dateKey, weekRange } from '../../shared/time.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const weekdays = ['一', '二', '三', '四'];
const shortDate = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

export function ServiceDayEditor({ campus, onNavigate, editorRef }) {
  const active = useContext(ActivityContext);
  const [today, setToday] = useState(dateKey()),
    [data, setData] = useState(null);
  const [selected, setSelected] = useState([]),
    [reason, setReason] = useState(''),
    [originalReason, setOriginalReason] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState(null),
    [retry, setRetry] = useState(0);
  const command = useRef(null),
    lock = useRef(false);
  const start = weekRange(today).start,
    end = addDays(start, 13),
    dirty = reason !== originalReason;
  const items = data?.campus === campus && data?.start === start ? data.items : [];
  const chosen = items.filter((item) => selected.includes(item.businessDate));
  const affectedCount = chosen.reduce((sum, item) => sum + item.affected.length, 0);
  useEffect(() => {
    if (!active) return;
    let controller,
      stopped = false;
    async function read() {
      controller?.abort();
      if (document.hidden) return;
      const current = new AbortController();
      controller = current;
      setLoading(true);
      setError('');
      try {
        const result = await request(
          '/api/service-days?' + new URLSearchParams({ campus, start, end }),
          { signal: current.signal }
        );
        if (stopped || current.signal.aborted) return;
        setData({ ...result, start });
        if (result.serverNow) setToday(dateKey(new Date(result.serverNow)));
      } catch (failure) {
        if (!stopped && !current.signal.aborted) {
          if ([401, 403].includes(failure.status)) {
            setData(null);
            setSelected([]);
          }
          setError(failure.message);
        }
      } finally {
        if (!stopped && !current.signal.aborted) setLoading(false);
      }
    }
    read();
    const visibility = () => {
      if (document.hidden) {
        controller?.abort();
        setLoading(false);
      } else read();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, campus, start, end, retry]);

  function select(dates) {
    setSelected(dates);
    setNotice('');
    if (!dirty) {
      const reasons = [
        ...new Set(
          items
            .filter((item) => dates.includes(item.businessDate))
            .map((item) => item.item?.reason || '')
        )
      ];
      const value = reasons.length === 1 ? reasons[0] : '';
      setReason(value);
      setOriginalReason(value);
    }
  }
  function discard() {
    setReason(originalReason);
    setConfirm(null);
    setError('');
    command.current = null;
  }
  async function save(paused) {
    if (lock.current) throw new Error('正在保存，请稍后再试。');
    const targets = chosen.filter((item) => paused || item.item?.paused);
    if (!targets.length || loading) throw new Error('请先选择需要调整的日期，并等待读取完成。');
    lock.current = true;
    setBusy(true);
    setError('');
    const body = {
      items: targets.map((item) => ({
        businessDate: item.businessDate,
        campusId: campus === '南湖' ? 'campus-nanhu' : 'campus-hunnan',
        paused,
        reason: paused ? (dirty ? reason : item.item?.reason || reason) : '',
        revision: item.item?.revision ?? -1
      }))
    };
    const signature = JSON.stringify(body);
    if (command.current?.signature !== signature)
      command.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await request('/api/service-days', {
        method: 'PATCH',
        body: { ...body, requestId: command.current.id }
      });
      setData((current) => ({
        ...current,
        items: current.items.map((item) => ({
          ...item,
          item: result.items.find((saved) => saved.businessDate === item.businessDate) || item.item
        }))
      }));
      setOriginalReason(reason);
      setConfirm(null);
      command.current = null;
      setNotice(
        paused
          ? `已暂停 ${targets.length} 天，暂停说明已同步至校区公告。已有预约保留，请联系受影响机主。`
          : `已恢复 ${targets.length} 天，相应暂停公告已撤下；原容量继续使用，班表不会自动改写。`
      );
    } catch (failure) {
      setError(failure.message);
      throw failure;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useUnsavedChanges({ dirty, active, busy, save: () => save(true), discard });
  if (editorRef) editorRef.current = { dirty, busy, save: () => save(true), discard };
  return (
    <section className="field-card service-day-editor" aria-busy={loading}>
      <div className="capacity-section-heading">
        <div>
          <h2>暂停日期</h2>
          <p className="field-muted">
            选择本周、下周的维修日，可一次暂停或恢复多天。日期均为北京时间。
          </p>
        </div>
        <button disabled={busy || loading} onClick={() => setRetry((value) => value + 1)}>
          {loading ? '正在读取…' : '读取最新安排'}
        </button>
      </div>
      <Notice>{error || notice}</Notice>
      {!items.length && !loading && !error && <p>暂时无法读取维修安排，请重试。</p>}
      <div className="service-day-weeks">
        {[0, 7].map((offset) => {
          const days = weekdays.map((_, index) => addDays(start, offset + index));
          const available = days.filter(
            (day) => day >= today && items.some((item) => item.businessDate === day)
          );
          const allSelected =
            available.length > 0 && available.every((day) => selected.includes(day));
          return (
            <section
              className="service-day-week"
              key={offset}
              aria-label={offset ? '下周维修日' : '本周维修日'}
            >
              <div className="service-day-week-heading">
                <h3>
                  {offset ? '下周' : '本周'}{' '}
                  <span>
                    {shortDate(days[0])} – {shortDate(days[3])}
                  </span>
                </h3>
                <button
                  aria-label={`${allSelected ? '取消' : '选择'}${offset ? '下周' : '本周'}全部日期`}
                  disabled={busy || loading || !available.length}
                  onClick={() =>
                    select(
                      allSelected
                        ? selected.filter((day) => !available.includes(day))
                        : [...new Set([...selected, ...available])]
                    )
                  }
                >
                  {allSelected ? '取消整周选择' : '选择整周'}
                </button>
              </div>
              <div className="service-day-grid">
                {days.map((day, index) => {
                  const item = items.find((item) => item.businessDate === day),
                    past = day < today;
                  const paused = !!item?.item?.paused;
                  return (
                    <button
                      key={day}
                      aria-label={`${day} 周${weekdays[index]} ${past ? '已过去' : !item ? '状态尚未读取' : paused ? '暂停维修' : '正常维修'}`}
                      aria-pressed={selected.includes(day)}
                      disabled={busy || loading || past || !item}
                      data-paused={paused}
                      onClick={() =>
                        select(
                          selected.includes(day)
                            ? selected.filter((value) => value !== day)
                            : [...selected, day].sort()
                        )
                      }
                    >
                      <span>周{weekdays[index]}</span>
                      <strong>{shortDate(day)}</strong>
                      <small>
                        {past ? (
                          '已过去'
                        ) : !item ? (
                          <DataValue label={`${day}维修状态`} pending={loading && !error} />
                        ) : paused ? (
                          '已暂停'
                        ) : (
                          '正常'
                        )}
                      </small>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="service-day-selection">
        <strong>已选 {chosen.length} 天</strong>
        <span>
          {chosen.length
            ? chosen.map((item) => shortDate(item.businessDate)).join('、')
            : '点击日期选择，再点取消'}
        </span>
        <button disabled={busy || !selected.length} onClick={() => select([])}>
          清空选择
        </button>
      </div>
      <label className="service-day-reason">
        暂停说明（同步为公告，可选）
        <textarea
          maxLength={200}
          rows={3}
          disabled={busy || !chosen.length}
          value={reason}
          placeholder="例如：校区设备维护，请改约其他日期。"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="service-day-preview" role="region" aria-label="暂停公告预览">
        <h3>当日暂停维修</h3>
        <p>{reason.trim() || '该校区当日暂停维修，请选择其他日期。'}</p>
        <small>
          保存后自动出现在校区公告中，并在学生选择对应日期时显示；恢复或日期结束后停止展示。
        </small>
      </div>
      <p className="field-muted">
        暂停当天的新预约、现场登记、开始维修和所有人员签到；办公和维修排班跳过此日。已有预约、班表和考勤保留，进行中的维修仍可完成。
      </p>
      {affectedCount > 0 && (
        <p className="service-day-impact">
          所选日期有 {affectedCount} 个预约需要联系机主，暂停不会自动取消预约。
        </p>
      )}
      <div className="field-actions">
        <button
          className="field-primary"
          disabled={busy || loading || !chosen.length}
          onClick={() => setConfirm('pause')}
        >
          暂停所选日期
        </button>
        <button
          disabled={busy || loading || !chosen.some((item) => item.item?.paused)}
          onClick={() => setConfirm('restore')}
        >
          恢复所选日期
        </button>
      </div>
      {confirm && (
        <Modal
          compact
          title={confirm === 'pause' ? '确认暂停维修' : '恢复维修'}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>
            {campus}校区 · {confirm === 'pause' ? '暂停' : '恢复'}以下日期
          </p>
          <ul className="service-day-confirm-dates">
            {chosen
              .filter((item) => confirm === 'pause' || item.item?.paused)
              .map((item) => (
                <li key={item.businessDate}>
                  <strong>{item.businessDate}</strong>
                  <span>
                    {item.affected.length ? `${item.affected.length} 个现有预约` : '无待处理预约'}
                  </span>
                </li>
              ))}
          </ul>
          <p>
            {confirm === 'pause'
              ? '已有预约不会取消，请联系机主。当天所有岗位停止签到，已有签到不计入本周有效考勤。暂停说明将同步发布。'
              : '恢复原容量并撤下对应暂停公告，已有班表不会自动改写。'}
          </p>
          {affectedCount > 0 && onNavigate && (
            <button
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                onNavigate('staff');
              }}
            >
              前往预约记录
            </button>
          )}
          <Notice>{error}</Notice>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setConfirm(null)}>
              返回
            </button>
            <button
              className="field-primary"
              disabled={busy}
              onClick={() => {
                void save(confirm === 'pause').catch(() => {});
              }}
            >
              {busy ? '正在保存…' : `确认${confirm === 'pause' ? '暂停' : '恢复'}`}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
