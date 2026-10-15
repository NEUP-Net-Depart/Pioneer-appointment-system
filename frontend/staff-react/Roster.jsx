import React, { useEffect, useState } from 'react';
import { request } from './request.js';

export function Roster({ user }) {
  const [assignments, setAssignments] = useState([]); const [tasks, setTasks] = useState([]); const [leaves, setLeaves] = useState([]); const [swaps, setSwaps] = useState([]); const [activeTab, setActiveTab] = useState('schedule'); const [selectedAssignment, setSelectedAssignment] = useState(null); const [reason, setReason] = useState(''); const [availability, setAvailability] = useState({ taskId: '', businessDate: '', startAt: '19:00', endAt: '21:00', campusId: 'campus-nanhu' }); const [swapForm, setSwapForm] = useState({ fromAssignmentId: '', toAssignmentId: '', toMemberId: '', fromRevision: 0, toRevision: 0, note: '' }); const [message, setMessage] = useState('');
  const [reviewLeaves, setReviewLeaves] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false); 
  const statusText = { pending: '待处理', approved: '已批准', rejected: '已拒绝', withdrawn: '已撤回', accepted: '已接受', declined: '已拒绝' };
  const canReview = user?.role === 'superadmin' || user?.grants?.some(grant => grant.permissionCode === 'leave.review');
  async function refresh() {
    try {
      const requests = [request('/api/me/roster'), request('/api/roster-tasks'), request('/api/leaves'), request('/api/swaps')];
      if (canReview) requests.push(request('/api/leaves?all=true'));
      const [mine, taskData, leaveData, swapData, allLeaves] = await Promise.all(requests);
      setAssignments(mine.items || []); setTasks(taskData.items || []); setLeaves(leaveData.items || []); setSwaps(swapData.items || []);
      setReviewLeaves(allLeaves?.items || []);
      if (!availability.taskId && taskData.items?.[0]) setAvailability(current => ({ ...current, taskId: taskData.items[0].id }));
    } catch (error) { setMessage(error.message); }
  }
  useEffect(() => { refresh(); }, [canReview]);
  useEffect(() => {
    let active = true;
    setCandidates([]);
    setSwapForm(current => ({ ...current, toAssignmentId: '', toMemberId: '', toRevision: 0 }));
    if (!swapForm.fromAssignmentId) { setCandidateLoading(false); return; }
    setCandidateLoading(true);
    request(`/api/swaps/candidates?assignmentId=${encodeURIComponent(swapForm.fromAssignmentId)}`)
      .then(data => { if (active) setCandidates(data.items || []); })
      .catch(error => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setCandidateLoading(false); });
    return () => { active = false; };
  }, [swapForm.fromAssignmentId]);
  function chooseTarget(id) {
    const item = candidates.find(candidate => candidate.id === id);
    setSwapForm(current => ({ ...current, toAssignmentId: item?.id || '', toMemberId: item?.memberId || '', toRevision: item?.revision || 0 }));
  }
  async function saveAvailability(event) { event.preventDefault(); try { await request(`/api/roster-tasks/${encodeURIComponent(availability.taskId)}/availability`, { method: 'PUT', body: availability }); setMessage('可值班时间已提交，负责人将在生成班表时看到'); } catch (error) { setMessage(error.message); } }
  async function applyLeave(event) { event.preventDefault(); if (!selectedAssignment) return setMessage('请先在班次卡中选择需要请假的班次'); try { await request('/api/leaves', { method: 'POST', body: { assignmentId: selectedAssignment.id, reason, requestId: crypto.randomUUID() } }); setReason(''); setMessage('请假申请已提交，等待负责人处理'); await refresh(); } catch (error) { setMessage(error.message); } }
  async function applySwap(event) {
    event.preventDefault();
    if (submitting || !swapForm.toAssignmentId) return;
    setSubmitting(true);
    try {
      await request('/api/swaps', { method: 'POST', body: { ...swapForm, requestId: crypto.randomUUID() } });
      setMessage('换班申请已发送，等待对方在“我的申请”确认');
      setSwapForm(current => ({ ...current, fromAssignmentId: '', toAssignmentId: '' }));
      await refresh();
    } catch (error) { setMessage(error.message); }
    finally { setSubmitting(false); }
  }
  async function decideLeave(item, decision) { try { await request(`/api/leaves/${encodeURIComponent(item.id)}/decision`, { method: 'POST', body: { decision, revision: item.revision, requestId: crypto.randomUUID() } }); setMessage(decision === 'approve' ? '请假已批准，覆盖影响已更新' : '请假已驳回'); await refresh(); } catch (error) { setMessage(error.message); } }
  async function decideSwap(item, decision) { try { await request(`/api/swaps/${encodeURIComponent(item.id)}/decision`, { method: 'POST', body: { decision, revision: item.revision, requestId: crypto.randomUUID() } }); setMessage(decision === 'accept' ? '换班已确认' : '已拒绝换班'); await refresh(); } catch (error) { setMessage(error.message); } }
  return <section className="react-page roster-page"><div className="react-heading"><div><p className="react-eyebrow">DUTY PLANNING</p><h1>我的值班安排</h1><p>{user?.name} · 先确认班次，再处理需要交接的事项。</p></div><button onClick={refresh}>刷新数据</button></div>{message && <p className="react-message" role="status">{message}</p>}<div className="roster-tabs" role="tablist"><button className={activeTab === 'schedule' ? 'is-active' : ''} onClick={() => setActiveTab('schedule')}>班次 <span>{assignments.length}</span></button><button className={activeTab === 'requests' ? 'is-active' : ''} onClick={() => setActiveTab('requests')}>我的申请 <span>{leaves.filter(item => item.status === 'pending').length + swaps.filter(item => item.status === 'pending').length}</span></button>{canReview && <button className={activeTab === 'review' ? 'is-active' : ''} onClick={() => setActiveTab('review')}>待处理 <span>{reviewLeaves.filter(item => item.actions?.review).length}</span></button>}</div>{activeTab === 'schedule' && <div className="roster-layout"><article className="react-card roster-primary"><div className="card-title-row"><div><h2>已发布班次</h2><p className="react-muted">从具体班次发起请假或换班，系统会自动带入版本。</p></div><span className="roster-count">{assignments.length} 个班次</span></div>{assignments.map(item => <div className={`duty-card ${selectedAssignment?.id === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedAssignment(item)}><div><strong>{item.businessDate}</strong><span>{item.startAt}–{item.endAt} · {item.campusName || item.campusId}</span><small>{item.roleKind || item.dutyType || '值班'}</small></div><div className="duty-actions"><button type="button" onClick={event => { event.stopPropagation(); setSelectedAssignment(item); setActiveTab('requests'); }}>请假</button><button type="button" onClick={event => { event.stopPropagation(); setSwapForm(current => ({ ...current, fromAssignmentId: item.id, fromRevision: item.revision })); setActiveTab('requests'); }}>发起换班</button></div></div>)}{!assignments.length && <div className="empty-state"><strong>本周还没有已发布班次</strong><span>班表发布后会在这里显示，开放填报可用时间仍可先提交。</span></div>}</article><article className="react-card roster-secondary"><h2>填报可用时间</h2><p className="react-muted">告诉负责人你能参加哪些日期和时段。</p><form onSubmit={saveAvailability}>{tasks.length ? <><label>排班任务<select value={availability.taskId} onChange={event => setAvailability({ ...availability, taskId: event.target.value })}>{tasks.map(task => <option key={task.id} value={task.id}>{task.weekStart} · {task.slotStart}–{task.slotEnd}</option>)}</select></label><label>日期<input type="date" required value={availability.businessDate} onChange={event => setAvailability({ ...availability, businessDate: event.target.value })} /></label><div className="react-inline"><label>开始<input type="time" value={availability.startAt} onChange={event => setAvailability({ ...availability, startAt: event.target.value })} /></label><label>结束<input type="time" value={availability.endAt} onChange={event => setAvailability({ ...availability, endAt: event.target.value })} /></label></div><button className="react-primary">提交可用时间</button></> : <div className="empty-state"><strong>暂无开放任务</strong><span>负责人发布排班收集任务后，这里会出现填写入口。</span></div>}</form></article></div>}{activeTab === 'requests' && <div className="roster-layout"><article className="react-card"><div className="card-title-row"><div><h2>发起申请</h2><p className="react-muted">每次只处理一个明确的班次变化。</p></div></div><form className="roster-form" onSubmit={applyLeave}><label>请假班次<select value={selectedAssignment?.id || ''} onChange={event => setSelectedAssignment(assignments.find(item => item.id === event.target.value) || null)}><option value="">请选择班次</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.businessDate} · {item.startAt}–{item.endAt} · {item.campusName || item.campusId}</option>)}</select></label><label>请假原因<textarea value={reason} onChange={event => setReason(event.target.value)} minLength="2" required placeholder="例如：课程考试，需要调班" /></label><button className="react-primary">提交请假申请</button></form><hr /><form className="roster-form" onSubmit={applySwap}><h3>发起换班</h3><label>我的班次<select required value={swapForm.fromAssignmentId} onChange={event => {
  const item = assignments.find(assignment => assignment.id === event.target.value);
  setSwapForm(current => ({ ...current, fromAssignmentId: item?.id || '', fromRevision: item?.revision || 0 }));
}}><option value="">选择需要调换的班次</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.businessDate} · {item.startAt}–{item.endAt} · {item.campusName}</option>)}</select></label>
<label>希望调换到<select required disabled={candidateLoading || !swapForm.fromAssignmentId} value={swapForm.toAssignmentId} onChange={event => chooseTarget(event.target.value)}><option value="">{candidateLoading ? '正在查询班次…' : '选择同校区、同岗位的本周班次'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.businessDate} · {item.startAt}–{item.endAt} · {item.memberName}</option>)}</select></label>
{swapForm.fromAssignmentId && !candidateLoading && !candidates.length && <p className="react-muted">本周暂无可选班次。请联系值班负责人协调。</p>}
<label>说明<input value={swapForm.note} onChange={event => setSwapForm({ ...swapForm, note: event.target.value })} placeholder="可选" /></label><button className="react-primary" disabled={submitting || !swapForm.toAssignmentId}>{submitting ? '正在发送…' : '发送换班邀请'}</button></form></article><article className="react-card"><h2>申请记录</h2><p className="react-muted">申请提交后可在这里查看结果，避免重复提交。</p>{leaves.map(item => <div className="request-row" key={`leave-${item.id}`}><div><strong>请假申请</strong><span>{item.reason}</span></div><span className={`status-pill status-${item.status}`}>{statusText[item.status] || item.status}</span>{item.actions?.withdraw && <button type="button" onClick={() => request(`/api/leaves/${encodeURIComponent(item.id)}/withdraw`, { method: 'POST', body: { revision: item.revision, requestId: crypto.randomUUID() } }).then(refresh).catch(error => setMessage(error.message))}>撤回</button>}</div>)}{swaps.map(item => <div className="request-row" key={`swap-${item.id}`}><div><strong>换班申请</strong><span>{item.fromAssignment?.businessDate} {item.fromAssignment?.startAt} → {item.toAssignment?.businessDate} {item.toAssignment?.startAt}</span></div><span className={`status-pill status-${item.status}`}>{statusText[item.status] || '处理中'}</span>{item.actions?.respond && <div className="review-actions"><button type="button" onClick={() => decideSwap(item, 'accept')}>接受换班</button><button type="button" onClick={() => decideSwap(item, 'decline')}>拒绝</button></div>}</div>)}{!leaves.length && !swaps.length && <div className="empty-state"><strong>还没有申请记录</strong><span>从班次卡发起请假或换班后，进展会显示在这里。</span></div>}</article></div>}{activeTab === 'review' && canReview && <div className="roster-layout"><article className="react-card"><h2>待处理申请</h2><p className="react-muted">先看影响，再做审批；每次操作都会写入审计。</p>{reviewLeaves.filter(item => item.actions?.review).map(item => <div className="review-row" key={item.id}><div><strong>请假 · {item.reason}</strong><span>{item.assignment?.businessDate} · {item.assignment?.startAt}–{item.assignment?.endAt} · {item.assignment?.campusName}</span></div><div className="review-actions"><button type="button" onClick={() => decideLeave(item, 'approve')}>批准</button><button type="button" onClick={() => decideLeave(item, 'reject')}>驳回</button></div></div>)}{!reviewLeaves.some(item => item.actions?.review) && <div className="empty-state"><strong>当前没有待处理申请</strong><span>新的申请会在这里出现。</span></div>}</article></div>}</section>;
}

