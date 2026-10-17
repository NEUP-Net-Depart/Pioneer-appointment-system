import React, { useContext, useEffect, useRef, useState } from 'react';
import {RequirementEditor} from './StaffingRequirements.jsx';
import {StaffIdentity} from './StaffIdentity';
import { request } from './request.js';
import { ActivityContext, Modal } from './field/ui';
import { Roster } from './Roster.jsx';
import { addDays, dateKey, weekRange } from '../../shared/time.js';
import { WorkspaceHeader } from './WorkspaceHeader';
import './roster.css';
import { staffPermission } from '../../shared/staff-access.js';
import { RosterScopeFields } from './RosterScopeFields.jsx';

const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
const campusIds = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
const slotKey = slot => `${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const slotLabel = slot => `${slot.businessDate.slice(5).replace('-', '/')} · ${campusNames[slot.campusId] || slot.campusId} · ${slot.startAt}–${slot.endAt}`;
const issues = { SLOTS_REQUIRED: '没有服务班次', COVERAGE_MISSING: '尚未安排人员', LEAD_COVERAGE_MISSING: '缺少有资格的负责人', MEMBER_UNAVAILABLE: '成员可用时间或资格已变化', LEAD_INELIGIBLE: '负责人资格已变化', MEMBER_WEEK_DUPLICATE: '同一成员本周重复排班', LOCKED_ASSIGNMENT_CHANGED: '锁定安排已变化', DUTY_TYPE_MISMATCH: '岗位类型不一致' };
Object.assign(issues,{LEAD_SURPLUS:'同一天只能安排 1 名负责人',ORDINARY_COVERAGE_MISSING:'普通维修人员未达到最低需求',MEMBER_WEEK_MISSING:'普通维修人员本周尚未排班',POOL_MISMATCH:'负责人和普通人员的名额不可混用'});

export function RosterArea({ user, section = 'mine', requestSignal = 0 }) {
  const active = useContext(ActivityContext);
  const canManage = staffPermission(user, 'roster.repair.manage');
  const canRead = staffPermission(user, 'roster.read');
  if (!canRead && canManage) section = 'manage';
  const [visited, setVisited] = useState([section]);
  useEffect(() => { setVisited(current => current.includes(section) ? current : [...current, section]); }, [section]);
  return <section className="roster-area">{visited.includes('manage') && canManage && <ActivityContext.Provider value={active && section === 'manage'}><div hidden={section !== 'manage'} className="roster-section"><RosterManager user={user} /></div></ActivityContext.Provider>}{visited.includes('mine') && canRead && <ActivityContext.Provider value={active && section !== 'manage'}><div hidden={section === 'manage'} className="roster-section"><Roster user={user} requestSignal={requestSignal} /></div></ActivityContext.Provider>}</section>;
}

function RosterManager({ user }) {
  const routeActive = useContext(ActivityContext);
  const [tasks, setTasks] = useState([]), [taskId, setTaskId] = useState('');
  const [data, setData] = useState(null), [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false);
  const [requirementsOpen,setRequirementsOpen]=useState(false),[requirementsDirty,setRequirementsDirty]=useState(false);
  const [scopeReady,setScopeReady] = useState(false);
  const [minimums,setMinimums]=useState([1,1,1,1]),[weeklyMinimum,setWeeklyMinimum]=useState(1);
  const serial = useRef(0), commandLock = useRef(false);
  const campuses = (user?.authorizedCampuses || []).map(value => ({ id: campusIds[value] || value, name: value }));
  const nextWeek = addDays(weekRange(dateKey()).start, 7);
  const [form, setForm] = useState({ weekStart: nextWeek, campusId: campuses[0]?.id || '', departmentIds:[], slotStart: '19:00', slotEnd: '21:00', deadline: `${addDays(nextWeek, -1)}T18:00`, description: '' });
  const task = tasks.find(item => item.id === taskId);
  const draft = data?.draft;
  const editable = draft?.status === 'draft';
  const optimization = draft?.inputSnapshotRef?.optimization;
  const balance = [...new Set((data?.slots || []).map(slot => slot.campusId))].map(campusId => {
    const counts = data.slots.filter(slot => slot.campusId === campusId).map(slot => rows.filter(item => item.leaveStatus !== 'approved' && slotKey(item) === slotKey(slot)).length);
    return { campusId, counts, spread: Math.max(...counts) - Math.min(...counts) };
  });
  const optimizationLabel = dirty ? '已调整，保存后重新校验' : draft?.sourceChanged ? '人员或可用时间已变化，请重新生成或核对' : !draft?.validation?.valid ? '覆盖或资格待补齐' :
    optimization?.complete && draft.solverStatus === 'optimal' ? '已完成均衡优化' :
    optimization?.reason === 'budget_exhausted' ? '已生成可行草稿，均衡优化尚未完成' : '已通过资格与覆盖校验';

  async function loadTasks() {
    const result = await request('/api/roster-tasks');
    const available = (result.items || []).filter(item => item.actions?.manage && item.dutyType !== 'office' && item.campusScope?.campusIds?.length);
    setTasks(available);
    setTaskId(current => current || available[0]?.id || '');
  }
  async function load(id) {
    const sequence = ++serial.current;
    setLoading(true); setError('');
    try {
      const result = await request(`/api/roster-tasks/${encodeURIComponent(id)}/roster`);
      if (sequence !== serial.current) return;
      setData(result); setRows(result.draft?.assignments || []); setDirty(false);
    } catch (failure) { if (sequence === serial.current) setError(failure.message); }
    finally { if (sequence === serial.current) setLoading(false); }
  }
  useEffect(() => { loadTasks().catch(failure => setError(failure.message)); }, []);
  useEffect(() => {
    setData(null); setRows([]); setDirty(false);
    if (taskId) load(taskId);
    return () => { serial.current += 1; };
  }, [taskId]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    const beforeNavigation = event => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    if (routeActive) window.addEventListener('staff-before-navigation', beforeNavigation);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('staff-before-navigation', beforeNavigation); };
  }, [dirty, routeActive]);

  async function run(operation) {
    if (commandLock.current) return;
    commandLock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { setError(failure.message); }
    finally { commandLock.current = false; setBusy(false); }
  }
  function generate() { return run(async () => {
    await request('/api/rosters/generate', { method: 'POST', body: { taskId, requestId: crypto.randomUUID() } });
    await load(taskId); setNotice('草稿已保存。请核对人员安排和覆盖提示。');
  }); }
  function save() { return run(async () => {
    await request(`/api/rosters/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: { version: draft.version, assignments: rows, requestId: crypto.randomUUID() } });
    await load(taskId); setNotice('调整已保存，已重新校验。');
  }); }
  function publish() { return run(async () => {
    await request(`/api/rosters/${encodeURIComponent(draft.id)}/publish`, { method: 'POST', body: { version: draft.version, requestId: crypto.randomUUID() } });
    setConfirming(false); await load(taskId); setNotice('班表已发布，成员可在“我的安排与申请”查看。');
  }); }
  function create(event) {
    event.preventDefault();
    if (!scopeReady) return;
    return run(async () => {
      const requirements=minimums.map((ordinaryMinimum,index)=>({businessDate:addDays(form.weekStart,index),campusId:form.campusId,ordinaryMinimum:Number(ordinaryMinimum)}));
      const result = await request('/api/roster-tasks', { method: 'POST', body: { ...form, requirements, deadline: new Date(form.deadline).toISOString(), requestId: crypto.randomUUID() } });
      await loadTasks(); setTaskId(result.id); setCreating(false); setNotice('收集任务已创建，成员现在可以填报时间。');
    });
  }
  function move(member, key) {
    const slot = member.available.find(item => slotKey(item) === key);
    setRows(current => [...current.filter(item => item.memberId !== member.memberId), ...(slot ? [{ memberId: member.memberId, ...slot, roleKind: member.leadSlots.some(item => slotKey(item) === key) ? 'repair_lead' : '' }] : [])]);
    setDirty(true); setNotice('');
  }
  const members = [...(data?.members || [])].sort((a,b)=>Number(b.pool==='lead')-Number(a.pool==='lead') || a.name.localeCompare(b.name,'zh-CN'));
  const missingMembers = rows.filter(row => !members.some(member => member.memberId === row.memberId));
  const changes = [...new Set([...rows, ...(data?.publishedAssignments || [])].map(item => item.memberId))].filter(id => {
    const previous = data?.publishedAssignments?.find(item => item.memberId === id), current = rows.find(item => item.memberId === id);
    return (previous ? slotKey(previous) + previous.roleKind : '') !== (current ? slotKey(current) + current.roleKind : '');
  }).length;

  return <section className="react-page roster-planner">
    <WorkspaceHeader group="值班管理" title="维修排班管理" description="收集可用时间，核对人员安排，再发布给成员。"><button type="button" disabled={busy || dirty} onClick={() => {setScopeReady(false); setCreating(true);}}>新建收集任务</button></WorkspaceHeader>
    {error && <p className="react-error" role="alert">{error}</p>}
    {notice && <p className="react-message" role="status">{notice}</p>}
    <div className="planner-toolbar"><label>排班周与校区<select disabled={busy || dirty || requirementsDirty} value={taskId} onChange={event => {setRequirementsOpen(false);setTaskId(event.target.value);}}><option value="">选择收集任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.weekStart} · {item.scopeLabel || item.campusScope.campusIds.map(id => campusNames[id] || id).join('、')} · {item.slotStart}–{item.slotEnd}</option>)}</select></label><button type="button" disabled={!taskId || busy || dirty || loading || requirementsDirty} onClick={() => load(taskId)}>刷新</button>{task?.actions?.configure && <button disabled={dirty || busy || requirementsDirty} onClick={()=>setRequirementsOpen(value=>!value)} aria-expanded={requirementsOpen}>{requirementsOpen?'收起人员需求':'配置人员需求'}</button>}</div>
    {taskId && requirementsOpen && <RequirementEditor taskId={taskId} onDirty={setRequirementsDirty} onSaved={()=>{loadTasks();load(taskId);}}/>}
    {data?.requiresRuleConfirmation && <p className="react-error" role="status">此任务沿用旧规则。请先在“配置人员需求”确认每天最低人数，再生成新草稿。</p>}
    {!taskId && <div className="react-card empty-state"><strong>先收集成员的可用时间</strong><span>创建任务后，成员在个人页面填报；生成的草稿会保存在服务端。</span></div>}
    {task && <p className="react-muted">填报截止：{new Date(task.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{task.description ? ` · ${task.description}` : ''}</p>}
    {loading && <p role="status">正在读取最新安排…</p>}
    {data && <>
      <div className="planner-summary"><strong>{draft ? (editable ? '排班草稿' : '已发布班表') : '等待生成草稿'}</strong><span>已安排 {rows.length} 人 · 负责人候选 {members.filter(member=>member.pool==='lead').length} 人 · 普通人员 {members.filter(member=>member.pool!=='lead').length} 人</span>{dirty && <span>有未保存的调整</span>}</div>
      {draft && <section className="planner-balance" aria-label="排班覆盖与均衡"><div><strong>{optimizationLabel}</strong><p>先安排可参加人员，再平衡各校区每日人数。发布时重新核验。</p></div><ul>{balance.map(campus => <li key={campus.campusId}><strong>{campusNames[campus.campusId] || campus.campusId}</strong><span>每日 {campus.counts.join(' / ')} 人</span><span>人数差 {campus.spread}</span></li>)}</ul></section>}
      <div className="planner-days">{data.slots.map(slot => {
        const assigned = rows.filter(item => slotKey(item) === slotKey(slot));
        const expected = assigned.filter(item => item.leaveStatus !== 'approved');
        const leaders=expected.filter(item=>item.roleKind==='repair_lead').length,ordinary=expected.length-leaders;
        return <article className="react-card" key={slotKey(slot)}><h2>{slot.businessDate.slice(5).replace('-', '/')}</h2><p>{campusNames[slot.campusId] || slot.campusId} · {slot.startAt}–{slot.endAt}</p><strong>预计 {expected.length} 人</strong><p className={leaders===1 ? 'react-muted' : 'planner-warning'}>负责人 {leaders} / 1</p>{slot.ordinaryMinimum!==undefined && <p className={ordinary>=slot.ordinaryMinimum?'react-muted':'planner-warning'}>普通人员 {ordinary} / 至少 {slot.ordinaryMinimum}</p>}<ul>{assigned.map(item => <li key={item.memberId}>{members.find(member => member.memberId === item.memberId)?.name || '资格已变化的成员'}{item.roleKind === 'repair_lead' && <small>负责人</small>}{item.leaveStatus && <small>{item.leaveStatus === 'approved' ? '请假已批准' : '请假待审批'}</small>}</li>)}</ul></article>;
      })}</div>
      {draft && <section className="react-card planner-editor"><h2>成员安排</h2><p className="react-muted">负责人每周最多一次，可以不排班；普通维修人员每周一次。锁定并保存的安排会在重新生成时保留。</p>{members.map(member => {
        const assigned = rows.find(item => item.memberId === member.memberId);
        return <div className="planner-member" key={member.memberId} data-pool={member.pool}><span><strong>{member.name}</strong><StaffIdentity identities={member.identities}/><small>{member.pool==='lead'?'负责人候选 · 本周最多一次':member.available.length ? `${member.available.length} 个可选时段 · 本周需排一次` : '暂无符合条件的时段，请联系成员补充填报'}</small></span><select aria-label={`安排${member.name}`} disabled={!editable || busy || assigned?.locked || requirementsDirty} value={assigned ? slotKey(assigned) : ''} onChange={event => move(member, event.target.value)}><option value="">{member.pool==='lead'?'本周不排班':'待安排'}</option>{member.available.map(slot => <option key={slotKey(slot)} value={slotKey(slot)}>{slotLabel(slot)}</option>)}</select>{editable && assigned && <label className="planner-lock"><input type="checkbox" checked={!!assigned.locked} disabled={busy} onChange={event => { const locked = event.target.checked; setRows(current => current.map(item => item.memberId === member.memberId ? { ...item, locked } : item)); setDirty(true); }} />锁定安排</label>}</div>;
      })}{missingMembers.map(item => <div className="planner-member" key={item.memberId}><span>有成员的账号或资格已变化，请移除后补位。</span><button disabled={!editable || busy} onClick={() => { setRows(current => current.filter(row => row.memberId !== item.memberId)); setDirty(true); }}>移除失效安排</button></div>)}</section>}
      {!dirty && draft?.validation?.errors?.length > 0 && <section className="react-card planner-issues"><h2>发布前需要处理</h2><ul>{draft.validation.errors.map((item, index) => <li key={index}>{issues[item.code] || '安排需要核对'}{item.slot?.businessDate ? ` · ${item.slot.businessDate}` : ''}</li>)}</ul></section>}
      <div className="planner-actions"><p>{dirty ? '先保存调整，再确认发布。' : draft?.status === 'published' ? '成员正在使用此班表。新草稿发布后才会替换。' : '发布前会再次检查成员资格和班次覆盖。'}</p><div>
        <button type="button" disabled={busy || dirty || loading || requirementsDirty || data?.requiresRuleConfirmation} onClick={generate}>{draft ? '重新生成草稿' : '生成草稿'}</button>
        {dirty && <button type="button" className="react-primary" disabled={busy} onClick={save}>保存并校验</button>}
        {editable && !dirty && <button type="button" className="react-primary" disabled={busy || loading || requirementsDirty || data?.requiresRuleConfirmation || !draft.validation.valid || draft.sourceChanged} onClick={() => setConfirming(true)}>预览并发布</button>}
      </div></div>
    </>}
{creating && <Modal title="收集下周可用时间" onClose={() => { if (!busy) setCreating(false); }}><form className="roster-create-form" onSubmit={create}><label>周一日期<input type="date" required value={form.weekStart} onChange={event => setForm({ ...form, weekStart: event.target.value })} /></label><RosterScopeFields dutyType="repair" value={form} onChange={scope => setForm(current => ({...current,...scope}))} onReady={setScopeReady} disabled={busy} /><fieldset className="staffing-editor" disabled={busy}><legend>本校区每日人员需求</legend><p className="react-muted">每天另排 1 名负责人。以下为普通维修人员最低人数，自动排班允许超额安排。其他校区可单独创建收集任务。</p><div className="staffing-quick"><label>整周最低人数<input type="number" min="0" max="300" step="1" value={weeklyMinimum} onChange={event=>setWeeklyMinimum(event.target.value)}/></label><button type="button" disabled={weeklyMinimum==='' || !Number.isInteger(Number(weeklyMinimum)) || Number(weeklyMinimum)<0 || Number(weeklyMinimum)>300} onClick={()=>setMinimums([1,1,1,1].map(()=>Number(weeklyMinimum)))}>应用到四个工作日</button></div><div className="staffing-days">{minimums.map((value,index)=><label key={index}><strong>{['周一','周二','周三','周四'][index]}</strong><span>{form.weekStart?addDays(form.weekStart,index).slice(5).replace('-','/'):'请先选择日期'}</span><span className="staffing-count"><input aria-label={`${['周一','周二','周三','周四'][index]}最低人数`} type="number" required min="0" max="300" step="1" value={value} onChange={event=>setMinimums(current=>current.map((item,i)=>i===index?event.target.value:item))}/>名普通人员</span></label>)}</div></fieldset><div className="react-inline"><label>开始<input type="time" required value={form.slotStart} onChange={event => setForm({ ...form, slotStart: event.target.value })} /></label><label>结束<input type="time" required value={form.slotEnd} onChange={event => setForm({ ...form, slotEnd: event.target.value })} /></label></div><label>填报截止<input type="datetime-local" required value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} /></label><label>说明<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>{error && <p role="alert" className="react-error">{error}</p>}<button className="field-primary" disabled={busy || !scopeReady}>创建收集任务</button></form></Modal>}
    {confirming && <Modal title="确认发布排班" onClose={() => { if (!busy) setConfirming(false); }}><p>{task?.weekStart} 起的班表，共安排 {rows.length} 人。</p><p>{changes} 位成员的安排与当前发布班表不同。确认后，成员端将显示这份班表。</p>{error && <p role="alert" className="react-error">{error}</p>}<div className="field-actions"><button disabled={busy} onClick={() => setConfirming(false)}>返回核对</button><button className="field-primary" disabled={busy} onClick={publish}>确认发布</button></div></Modal>}
  </section>;
}
