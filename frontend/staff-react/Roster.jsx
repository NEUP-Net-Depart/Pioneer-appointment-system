import React, { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext } from './field/ui';
import { SwapComposer, SwapInvitations } from './SwapRequests';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceSections } from './WorkspaceSections';
import { requestStatusLabel } from '../../shared/staff-request-status.js';
import { addDays, dateKey, weekRange } from '../../shared/time.js';

const dutyLabels = { repair: '维修值班', office: '办公接待', repair_lead: '维修值班负责人', office_lead: '办公值班负责人', coordinator: '办公接待 · 当日协调人' };

export function Roster({ user, requestSignal = 0 }) {
  const active = useContext(ActivityContext), controller = useRef(null), fetchedAt = useRef(0);
  const [swapSource, setSwapSource] = useState('');
  const [requestType, setRequestType] = useState('leave');
  const [weekStart, setWeekStart] = useState(weekRange(dateKey()).start);
  const readSerial = useRef(0), leaveCommand = useRef(null), leaveBusy = useRef(false);
  const [sendingLeave, setSendingLeave] = useState(false);
  const [assignments, setAssignments] = useState([]); const [tasks, setTasks] = useState([]); const [leaves, setLeaves] = useState([]); const [swaps, setSwaps] = useState([]); const [activeTab, setActiveTab] = useState('schedule'); const [selectedAssignment, setSelectedAssignment] = useState(null); const [reason, setReason] = useState(''); const [availability, setAvailability] = useState({ taskId: '', businessDate: '', startAt: '19:00', endAt: '21:00', campusId: 'campus-nanhu' }); const [message, setMessage] = useState('');
  const [submittedWindows, setSubmittedWindows] = useState([]);
  useEffect(() => { if (requestSignal) setActiveTab('requests'); }, [requestSignal]);
  const selectedTask = tasks.find(task => task.id === availability.taskId);
  async function refresh() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    const sequence = ++readSerial.current;
    try {
      const requests = [request(`/api/me/roster?weekStart=${encodeURIComponent(weekStart)}`, { signal:current.signal }), request('/api/roster-tasks', { signal:current.signal }), request('/api/leaves', { signal:current.signal }), request('/api/swaps', { signal:current.signal })];
      const [mine, taskData, leaveData, swapData] = await Promise.all(requests);
      if (sequence !== readSerial.current) return;
      taskData.items = (taskData.items || []).filter(task => task.dutyType !== 'office');
      fetchedAt.current = Date.now();
      setAssignments(mine.items || []); setTasks(taskData.items || []); setLeaves(leaveData.items || []); setSwaps(swapData.items || []);
      if (!availability.taskId && taskData.items?.[0]) setAvailability(current => ({ ...current, taskId: taskData.items[0].id, businessDate: taskData.items[0].weekStart, startAt: taskData.items[0].slotStart, endAt: taskData.items[0].slotEnd, campusId: taskData.items[0].campusScope?.campusIds?.[0] || '' }));
    } catch (error) { if (sequence === readSerial.current && !current.signal.aborted) setMessage(error.message); }
  }
  useEffect(() => { setSelectedAssignment(null); setSwapSource(''); fetchedAt.current = 0; }, [weekStart]);
  useEffect(() => {
    if (!active) return;
    const read = () => { if (!document.hidden) refresh(); };
    if (!fetchedAt.current || Date.now() - fetchedAt.current >= 30000) read();
    const timer = setInterval(read, 30000);
    const visibility = () => { if (document.hidden) { controller.current?.abort(); readSerial.current++; } else if (Date.now() - fetchedAt.current >= 30000) read(); };
    document.addEventListener('visibilitychange',visibility);
    return () => { clearInterval(timer); controller.current?.abort(); readSerial.current++; document.removeEventListener('visibilitychange',visibility); };
  }, [active,weekStart]);
  useEffect(() => {
    let active = true;
    setSubmittedWindows([]);
    if (!availability.taskId) return;
    request(`/api/roster-tasks/${encodeURIComponent(availability.taskId)}/availability`)
      .then(data => { if (active) setSubmittedWindows((data.items || []).filter(item => item.memberId === (user?.memberId || user?.actor?.memberId))); })
      .catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [availability.taskId, user?.memberId, user?.actor?.memberId]);
  function chooseTask(id) {
    const task = tasks.find(item => item.id === id);
    if (task) setAvailability({ taskId: id, businessDate: task.weekStart, startAt: task.slotStart, endAt: task.slotEnd, campusId: task.campusScope?.campusIds?.[0] || '' });
  }
  async function saveAvailability(event) { event.preventDefault(); try { const saved = await request(`/api/roster-tasks/${encodeURIComponent(availability.taskId)}/availability`, { method: 'PUT', body: availability }); setSubmittedWindows(Array.isArray(saved) ? saved : saved.items || []); setMessage('可值班时间已提交，负责人将在生成班表时看到'); } catch (error) { setMessage(error.message); } }
  async function applyLeave(event) {
    event.preventDefault();
    if (leaveBusy.current) return;
    const selected = assignments.find(item => item.id === selectedAssignment?.id);
    if (!selected || selected.leaveStatus) return setMessage('请在当前班次中选择尚未请假的班次');
    const key = JSON.stringify([selected.id, reason]);
    if (leaveCommand.current?.key !== key) leaveCommand.current = { key, requestId: crypto.randomUUID() };
    leaveBusy.current = true; setSendingLeave(true);
    try {
      await request('/api/leaves', { method: 'POST', body: { assignmentId: selected.id, reason, requestId: leaveCommand.current.requestId } });
      leaveCommand.current = null; setReason(''); setSelectedAssignment(null);
      setMessage('请假申请已提交，等待负责人处理'); await refresh();
    } catch (error) { setMessage(error.message); }
    finally { leaveBusy.current = false; setSendingLeave(false); }
  }
  return <section className="react-page roster-page"><WorkspaceHeader group="我的" title="我的值班安排" description={`${user?.name} · 先确认班次，再处理需要交接的事项。`}><button onClick={refresh}>刷新数据</button></WorkspaceHeader>{message && <p className="react-message" role="status">{message}</p>}<WorkspaceSections label="班次与申请" value={activeTab} onChange={setActiveTab} items={[
    { id: 'schedule', label: '班次', count: assignments.length },
    { id: 'requests', label: '我的申请', count: leaves.filter(item => item.status === 'pending').length + swaps.filter(item => item.status === 'pending').length },
  ]} />{activeTab === 'schedule' && <><div className="roster-week-nav" aria-label="查看值班周"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>上一周</button><label>值班周<input type="date" value={weekStart} onChange={event => { if (event.target.value) setWeekStart(weekRange(event.target.value).start); }} /></label><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>下一周</button><button type="button" onClick={() => setWeekStart(weekRange(dateKey()).start)}>本周</button></div><div className="roster-layout"><article className="react-card roster-primary"><div className="card-title-row"><div><h2>已发布班次</h2><p className="react-muted">从具体班次发起请假或换班，系统会自动带入版本。</p></div><span className="roster-count">{assignments.length} 个班次</span></div>{assignments.map(item => <div className={`duty-card ${selectedAssignment?.id === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedAssignment(item)}><div><strong>{item.businessDate}</strong><span>{item.startAt}–{item.endAt} · {item.campusName || item.campusId}</span><small>{dutyLabels[item.roleKind] || dutyLabels[item.dutyType] || '值班安排'}</small>{item.leaveStatus && <span className="account-state" data-state={item.leaveStatus}>请假 · {requestStatusLabel(item.leaveStatus)}</span>}</div><div className="duty-actions"><button type="button" disabled={!!item.leaveStatus} onClick={event => { event.stopPropagation(); setSelectedAssignment(item); setRequestType('leave'); setActiveTab('requests'); }}>请假</button><button type="button" disabled={!!item.leaveStatus} onClick={event => { event.stopPropagation(); setSwapSource(item.id); setRequestType('swap'); setActiveTab('requests'); }}>发起换班</button></div></div>)}{!assignments.length && <div className="empty-state"><strong>所选周还没有已发布班次</strong><span>班表发布后会在这里显示，开放填报可用时间仍可先提交。</span></div>}</article><article className="react-card roster-secondary"><h2>填报可用时间</h2><p className="react-muted">告诉负责人你能参加哪些日期和时段。</p><form onSubmit={saveAvailability}>{tasks.length ? <><label>排班任务<select value={availability.taskId} onChange={event => chooseTask(event.target.value)}>{tasks.map(task => <option key={task.id} value={task.id}>{task.weekStart} · {task.slotStart}–{task.slotEnd}</option>)}</select></label><label>校区<select value={availability.campusId} onChange={event => setAvailability({ ...availability, campusId: event.target.value })}>{(selectedTask?.campusScope?.campusIds || []).map(id => <option key={id} value={id}>{({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' })[id] || '任务校区'}</option>)}</select></label><label>日期<input type="date" min={selectedTask?.weekStart} required value={availability.businessDate} onChange={event => setAvailability({ ...availability, businessDate: event.target.value })} /></label><div className="react-inline"><label>开始<input type="time" value={availability.startAt} onChange={event => setAvailability({ ...availability, startAt: event.target.value })} /></label><label>结束<input type="time" value={availability.endAt} onChange={event => setAvailability({ ...availability, endAt: event.target.value })} /></label></div><button className="react-primary">提交可用时间</button></> : <div className="empty-state"><strong>暂无开放任务</strong><span>负责人发布排班收集任务后，这里会出现填写入口。</span></div>}</form>{submittedWindows.length > 0 && <div className="react-list-item"><strong>已提交的可用时间</strong>{submittedWindows.map(item => <span key={item.id}>{item.businessDate} · {item.startAt}–{item.endAt}</span>)}</div>}</article></div></>}{activeTab === 'requests' && <div className="roster-layout"><article className="react-card"><div className="card-title-row"><div><h2>发起申请</h2><p className="react-muted">每次只处理一个明确的班次变化。</p></div></div><WorkspaceSections label="申请类型" value={requestType} onChange={setRequestType} items={[{ id: 'leave', label: '请假' }, { id: 'swap', label: '换班' }]} /><form hidden={requestType !== 'leave'} className="roster-form" onSubmit={applyLeave}><label>请假班次<select disabled={sendingLeave} value={selectedAssignment?.id || ''} onChange={event => setSelectedAssignment(assignments.find(item => item.id === event.target.value) || null)}><option value="">请选择班次</option>{assignments.map(item => <option disabled={!!item.leaveStatus} key={item.id} value={item.id}>{item.businessDate} · {item.startAt}–{item.endAt} · {item.campusName || item.campusId}</option>)}</select></label><label>请假原因<textarea disabled={sendingLeave} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} minLength="2" required placeholder="例如：课程考试，需要调班" /></label><button className="react-primary" disabled={sendingLeave || !selectedAssignment || !!assignments.find(item => item.id === selectedAssignment.id)?.leaveStatus}>{sendingLeave ? '正在提交…' : '提交请假申请'}</button></form><div hidden={requestType !== 'swap'}><ActivityContext.Provider value={active && requestType === 'swap'}><SwapComposer assignments={assignments} initialAssignmentId={swapSource} onChanged={refresh} onMessage={setMessage} /></ActivityContext.Provider></div></article><article className="react-card"><h2>申请记录</h2><p className="react-muted">申请提交后可在这里查看结果，避免重复提交。</p>{leaves.map(item => <div className="request-row" key={`leave-${item.id}`}><div><strong>请假申请</strong><span>{item.reason}</span>{item.reviewNote && <small>审批说明：{item.reviewNote}</small>}</div><span className={`status-pill status-${item.status}`}>{requestStatusLabel(item.status)}</span>{item.actions?.withdraw && <button type="button" onClick={() => request(`/api/leaves/${encodeURIComponent(item.id)}/withdraw`, { method: 'POST', body: { revision: item.revision, requestId: crypto.randomUUID() } }).then(refresh).catch(error => setMessage(error.message))}>撤回</button>}</div>)}<SwapInvitations items={swaps} onChanged={refresh} onMessage={setMessage} />{!leaves.length && !swaps.length && <div className="empty-state"><strong>还没有申请记录</strong><span>从班次卡发起请假或换班后，进展会显示在这里。</span></div>}</article></div>}</section>;
}

