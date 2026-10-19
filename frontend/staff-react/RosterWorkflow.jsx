import React,{useContext,useEffect,useRef,useState} from 'react';
import {request} from './request.js';
import {ActivityContext,Modal} from './field/ui';
import {WorkspaceHeader} from './WorkspaceHeader';
import {WorkspaceMoreActions} from './WorkspaceMoreActions';
import {StaffIdentity} from './StaffIdentity';
import {RosterAssignment,RosterAssignmentControls,RosterReportedTimes} from './RosterAssignment';
import {RequirementEditor} from './StaffingRequirements.jsx';
import {staffPermission} from '../../shared/staff-access.js';
import {addDays,dateKey,weekRange} from '../../shared/time.js';
import {WeekPicker} from './WeekPicker';
import {dutyEnd} from '../../shared/duty-window.js';
import {CollectionScope} from './CollectionScope';
import {CollectionSettings} from './CollectionSettings';
import {preferredRosterPeriod} from '../../shared/roster-collections.js';
import './roster.css';
import './roster-workflow.css';

const campuses={'campus-nanhu':'南湖校区','campus-hunnan':'浑南校区'};
const days=['周一','周二','周三','周四'];
const key=slot=>`${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const label=slot=>`${slot.businessDate.slice(5).replace('-','/')} · ${campuses[slot.campusId]} · ${slot.startAt}–${slot.endAt}`;
const issueLabels={OFFICE_COVERAGE_MISSING:'办公人员未达到目标',COVERAGE_MISSING:'尚未安排人员',LEAD_COVERAGE_MISSING:'缺少负责人',ORDINARY_COVERAGE_MISSING:'普通人员低于最低需求',LEAD_SURPLUS:'只能安排一名负责人',MEMBER_WEEK_MISSING:'本周尚未安排',MEMBER_WEEK_DUPLICATE:'本周重复安排',MEMBER_DAY_DUPLICATE:'同日重复安排',MEMBER_UNAVAILABLE:'资格、授权或班次冲突',LEAD_INELIGIBLE:'负责人资格不符',POOL_MISMATCH:'人员身份与名额不符',LOCKED_ASSIGNMENT_CHANGED:'锁定安排已改变',DUTY_TYPE_MISMATCH:'岗位不匹配'};
const repairStages=['发布收集','收集进度','调整班表','检查发布'];
export function RosterStage({stage}) {
  const steps=repairStages;
  const current=stage==='scheduled'||stage==='collecting'||stage==='ready' ? 1 : stage==='published' ? 3 : 2;
  return <ol className="roster-steps" aria-label="排班流程">{steps.map((text,i)=><li key={text} aria-current={i===current ? 'step':undefined} data-complete={i<current}><span>{i+1}</span>{text}</li>)}</ol>;
}

function CollectionComposer({office,onClose,onCreated,onError}) {
  const next=addDays(weekRange(dateKey()).start,7);
  const [form,setForm]=useState({weekStart:next,campusIds:[],departmentIds:[],slotStart:'19:00',slotEnd:'21:00',deadline:`${addDays(next,-1)}T18:00`,description:'',collectionName:'',recurrence:{enabled:false,publishWeekday:4,publishTime:'18:00',deadlineWeekday:7,deadlineTime:'18:00'}});
  const [options,setOptions]=useState([]),[people,setPeople]=useState([]),[selected,setSelected]=useState([]),[requirements,setRequirements]=useState({}),[uniform,setUniform]=useState(1);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[step,setStep]=useState(0);
  const lock=useRef(false),id=useRef(crypto.randomUUID());
  const change=patch=>setForm(current=>({...current,...patch}));
  useEffect(()=>{const controller=new AbortController();request(`/api/roster-tasks/options?dutyType=${office?'office':'repair'}`,{signal:controller.signal}).then(result=>{
    setOptions(result.items);const first=result.items[0];if(first)change({campusIds:[first.campusId],departmentIds:first.allDepartments ? [] : [first.departments[0]?.id].filter(Boolean)});
  }).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});return()=>controller.abort();},[office]);
  useEffect(()=>{
    if(!form.campusIds.length)return;
    const controller=new AbortController();setLoading(true);
    const timer=setTimeout(()=>request('/api/roster-tasks/candidates',{method:'POST',body:{...form,dutyType:office?'office':'repair'},signal:controller.signal}).then(result=>{setPeople(result.items);setSelected(result.items.map(item=>item.memberId));setError('');}).catch(failure=>{if(!controller.signal.aborted){setError(failure.message);setPeople([]);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[office,form.weekStart,JSON.stringify(form.campusIds),JSON.stringify(form.departmentIds)]);
  const chosen=options.filter(item=>form.campusIds.includes(item.campusId));
  const allDepartments=chosen.length>0 && chosen.every(item=>item.allDepartments);
  const departments=(chosen[0]?.departments || []).filter(dept=>chosen.every(item=>item.departments.some(row=>row.id===dept.id)));
  function chooseCampus(campusId) {
    const ids=form.campusIds.includes(campusId)?form.campusIds.filter(id=>id!==campusId):[...form.campusIds,campusId];
    const scope=options.filter(item=>ids.includes(item.campusId));
    const shared=(scope[0]?.departments || []).filter(item=>scope.every(row=>row.departments.some(dept=>dept.id===item.id)));
    change({campusIds:ids,departmentIds:scope.every(item=>item.allDepartments)?[]:shared.slice(0,1).map(item=>item.id)});
  }
  async function submit(event) {
    event.preventDefault();if(step<2){setStep(step+1);return;}if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      const result=await request('/api/roster-tasks',{method:'POST',body:{...form,campusId:form.campusIds[0],dutyType:office?'office':'repair',workflowVersion:1,
        deadline:new Date(form.deadline).toISOString(),memberIds:selected,
        requirements:form.campusIds.flatMap(campusId=>days.map((_,index)=>({campusId,businessDate:addDays(form.weekStart,index),ordinaryMinimum:Number(requirements[`${campusId}:${index}`] ?? 1)}))),requestId:id.current}});
      onCreated(result.id);
    }catch(failure){setError(failure.message);onError?.(failure.message);}finally{lock.current=false;setBusy(false);}
  }
  return <Modal title={office?'发布办公收集任务':'发布收集任务'} onClose={()=>{if(!busy)onClose();}}><form className="roster-compose" onSubmit={submit}>
    <ol className="roster-compose-steps" aria-label="收集发布步骤">{['范围与时间','人数与名单','确认发布'].map((text,index)=><li key={text} aria-current={step===index?'step':undefined}><span>{index+1}</span>{text}</li>)}</ol>
    {step===0&&<section className="roster-compose-section"><h2>先确定收集范围与时间</h2><p className="react-muted">选择首个工作周及参与校区。每周开放的任务只需发布一次。</p>    <WeekPicker label="周一日期" value={form.weekStart} onChange={weekStart=>change({weekStart,deadline:`${addDays(weekStart,-1)}T18:00`})}/>
    <fieldset disabled={busy}><legend>参与校区</legend><div className="roster-choice-row">{options.map(item=><label key={item.campusId}><input type="checkbox" checked={form.campusIds.includes(item.campusId)} onChange={()=>chooseCampus(item.campusId)}/>{item.name}</label>)}</div></fieldset>
    <fieldset disabled={busy}><legend>参与部门</legend><div className="roster-choice-row">{allDepartments && <button type="button" aria-pressed={!form.departmentIds.length} onClick={()=>change({departmentIds:[]})}>全部部门</button>}{departments.map(item=><button type="button" aria-pressed={form.departmentIds.includes(item.id)} key={item.id} onClick={()=>change({departmentIds:form.departmentIds.includes(item.id)?form.departmentIds.filter(id=>id!==item.id):[...form.departmentIds,item.id]})}>{item.name}</button>)}</div>{!allDepartments&&!form.departmentIds.length&&<p className="react-error">请至少选择一个可管理的部门。</p>}</fieldset>
    <div className="roster-time-fields"><label>开始时间<input type="time" required value={form.slotStart} onChange={event=>change({slotStart:event.target.value,slotEnd:dutyEnd(event.target.value)})}/></label><label>结束时间<output>{form.slotEnd||"请选择 22:00 之前的开始时间"} · 整次两小时</output></label></div>
<label>填报截止<input type="datetime-local" required value={form.deadline} onChange={event=>change({deadline:event.target.value})}/></label><fieldset><legend>后续收集</legend><label className="roster-choice-row"><input type="checkbox" checked={form.recurrence.enabled} onChange={event=>change({recurrence:{...form.recurrence,enabled:event.target.checked}})}/>结束后继续收集下一周</label>{form.recurrence.enabled&&<><label>收集名称<input maxLength={80} value={form.collectionName} onChange={event=>change({collectionName:event.target.value})} placeholder={office?'办公可用时间收集':'维修可用时间收集'}/></label><p className="react-muted">发布一次即可。本次到期或提前结束后立即开放下一工作周；历史周可以同时重新开放补填。截止时间为值班前一周，北京时间。</p>{[['deadline','填报截止']].map(([prefix,text])=><div className="roster-time-fields" key={prefix}><label>{text}星期<select aria-label={`${text}星期`} value={form.recurrence[`${prefix}Weekday`]} onChange={event=>change({recurrence:{...form.recurrence,[`${prefix}Weekday`]:Number(event.target.value)}})}>{[1,2,3,4,5,6,7].map(i=><option key={i} value={i}>周{['一','二','三','四','五','六','日'][i-1]}</option>)}</select></label><label>{text}时间<input type="time" required value={form.recurrence[`${prefix}Time`]} onChange={event=>change({recurrence:{...form.recurrence,[`${prefix}Time`]:event.target.value}})}/></label></div>)}</>}</fieldset><label>任务说明<textarea maxLength={500} value={form.description} onChange={event=>change({description:event.target.value})}/></label></section>}
    {step===1&&<section className="roster-compose-section"><h2>安排多少人，向谁收集</h2><p className="react-muted">人数需求与参与名单都保存在任务内，后续排班直接使用。</p>    {<fieldset className="roster-demand-matrix" disabled={busy}><legend>{office?'每日办公人员目标人数':'每日普通维修人员最低需求'}</legend><p className="react-muted">{office?'自动排班按目标人数安排，优先均衡周内次数，每人每天最多一班。':'每个校区每天另排 1 名负责人，普通人员允许超过最低人数。'}</p><div className="roster-uniform"><label>统一人数<input type="number" min="0" max="300" required value={uniform} onChange={event=>setUniform(event.target.value)}/></label><button type="button" onClick={()=>setRequirements(Object.fromEntries(form.campusIds.flatMap(id=>days.map((_,i)=>[`${id}:${i}`,Number(uniform)]))))}>应用到所有工作日</button></div>
      {form.campusIds.map(campusId=><div className="roster-campus-demand" key={campusId}><div><strong>{campuses[campusId]}</strong><button type="button" onClick={()=>setRequirements(current=>({...current,...Object.fromEntries(days.map((_,i)=>[`${campusId}:${i}`,current[`${campusId}:0`] ?? 1]))}))}>周一复制到整周</button></div><div>{days.map((day,i)=><label key={day}>{day}<small>{addDays(form.weekStart,i).slice(5)}</small><input aria-label={`${campuses[campusId]}${day}最低人数`} required type="number" min="0" max="300" value={requirements[`${campusId}:${i}`] ?? 1} onChange={event=>setRequirements(current=>({...current,[`${campusId}:${i}`]:event.target.value}))}/></label>)}</div></div>)}
    </fieldset>}
<details className="roster-audience"><summary>参与名单 · {loading?'正在读取':`${selected.length} 人`}</summary><p className="react-muted">排班资格按工作周判断，交流人员不参加维修收集。发布后保存本次名单。</p><label>查找成员<input value={search} onChange={event=>setSearch(event.target.value)}/></label><button type="button" onClick={()=>setSelected(people.map(item=>item.memberId))}>选择全部</button><div>{people.filter(item=>item.name.includes(search)).map(item=><label key={item.memberId}><input type="checkbox" checked={selected.includes(item.memberId)} onChange={()=>setSelected(current=>current.includes(item.memberId)?current.filter(id=>id!==item.memberId):[...current,item.memberId])}/><span>{item.name}<StaffIdentity identities={item.identities}/></span></label>)}</div></details></section>}
    {step===2&&<section className="roster-compose-section"><h2>确认后向工作人员开放</h2><dl className="roster-review-summary"><div><dt>工作周</dt><dd>{form.weekStart} — {addDays(form.weekStart,3)}</dd></div><div><dt>参与范围</dt><dd>{form.campusIds.map(id=>campuses[id]).join('、')} · {selected.length} 人</dd></div><div><dt>班次</dt><dd>{form.slotStart}–{form.slotEnd}</dd></div><div><dt>首周截止</dt><dd>{form.deadline.replace('T',' ')}</dd></div><div><dt>后续填写</dt><dd>{form.recurrence.enabled?'本次结束后立即收集下一工作周':'仅收集本次工作周'}</dd></div></dl><div className="roster-review-needs">{form.campusIds.map(id=><div key={id}><strong>{campuses[id]}</strong><span>{days.map((day,i)=>`${day} ${requirements[`${id}:${i}`]??1} 人`).join(' · ')}</span></div>)}</div>{!office&&<p className="react-muted">以上为普通人员最低需求；每校区每天另排一名维修负责人。</p>}<div className="roster-review-edit"><button type="button" onClick={()=>setStep(0)}>修改范围与时间</button><button type="button" onClick={()=>setStep(1)}>修改人数与名单</button></div></section>}
    {error&&<p role="alert" className="react-error">{error}</p>}<div className="roster-modal-actions"><button type="button" disabled={busy} onClick={()=>step?setStep(step-1):onClose()}>{step?'上一步':'取消'}</button><button className="field-primary" disabled={busy||loading||!form.campusIds.length||!allDepartments&&!form.departmentIds.length||!selected.length}>{busy?'正在提交…':step===0?'下一步：人数与名单':step===1?'下一步：确认发布':office?'发布办公收集':'发布收集任务'}</button></div>
  </form></Modal>;
}

export function RosterWorkflow({user,office=false}) {
  const active=useContext(ActivityContext),canCreate=staffPermission(user,office?'roster.office.manage':'roster.repair.manage');
  const [tasks,setTasks]=useState([]),[taskId,setTaskId]=useState(''),[data,setData]=useState(null),[rows,setRows]=useState([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [creating,setCreating]=useState(false),[panel,setPanel]=useState(''),[choosing,setChoosing]=useState(null),[query,setQuery]=useState(''),[confirmOverride,setConfirmOverride]=useState(null);
  const [mobileDay,setMobileDay]=useState(0),[reopenDeadline,setReopenDeadline]=useState(''),[requirementsDirty,setRequirementsDirty]=useState(false);
  const [extraPeople,setExtraPeople]=useState([]),[addedPeople,setAddedPeople]=useState([]);
  const [poolQuery,setPoolQuery]=useState(''),[view,setView]=useState('auto'),[candidatePool,setCandidatePool]=useState('all'),[showConflicts,setShowConflicts]=useState(false);
  const lock=useRef(false),serial=useRef(0),readController=useRef(null),command=useRef(null);
  const listedTask=tasks.find(item=>item.id===taskId);
  const manage=!!listedTask?.actions?.manage;
  const task=data?.task ? {...listedTask,...data.task} : listedTask,draft=data?.draft,editable=manage&&draft?.status==='draft',collecting=data?.collectionState==='open';
  async function loadTasks(preferred) {
    const result=await request('/api/roster-tasks');const items=result.items.filter(item=>(office?item.dutyType==='office':item.dutyType!=='office')&&(item.actions?.manage||item.actions?.configure));
    setTasks(items);setTaskId(current=>preferred||(items.some(item=>item.id===current)?current:preferredRosterPeriod(items)?.id)||'');
  }
  async function load(id,{background=false}={}) {
    const seq=++serial.current;readController.current?.abort();const controller=new AbortController();readController.current=controller;
    if(!background)setLoading(true);
    try {
      const result=await request(`/api/roster-tasks/${encodeURIComponent(id)}/${manage?'roster':'requirements'}`,{signal:controller.signal});
      if(seq!==serial.current)return;
      setData(result);setRows(result.draft?.assignments||[]);setError('');
    }catch(failure){if(!controller.signal.aborted)setError(failure.message);}finally{if(seq===serial.current)setLoading(false);}
  }
  useEffect(()=>{loadTasks().catch(failure=>setError(failure.message));},[office]);
  useEffect(()=>{setData(null);setRows([]);setDirty(false);setPanel('');setView('auto');setMobileDay(0);if(taskId)load(taskId);return()=>{serial.current++;readController.current?.abort();};},[taskId,manage]);
  useEffect(()=>{
    if(!active||!taskId||dirty||requirementsDirty||busy||panel||choosing)return;
    const refresh=()=>{if(!document.hidden)load(taskId,{background:true});};
    const timer=setInterval(refresh,30000);const visibility=()=>{if(document.hidden)readController.current?.abort();else refresh();};
    document.addEventListener('visibilitychange',visibility);return()=>{clearInterval(timer);readController.current?.abort();document.removeEventListener('visibilitychange',visibility);};
  },[active,taskId,dirty,requirementsDirty,busy,panel,choosing]);
  useEffect(()=>{
    if(!dirty&&!requirementsDirty)return;
    const guard=event=>event.preventDefault(),unload=event=>{event.preventDefault();event.returnValue='';};
    if(active)window.addEventListener('staff-before-navigation',guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener('staff-before-navigation',guard);window.removeEventListener('beforeunload',unload);};
  },[dirty,requirementsDirty,active]);
  async function run(kind,path,body,method='POST') {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    const signature=JSON.stringify([kind,path,body]);if(command.current?.signature!==signature)command.current={signature,id:crypto.randomUUID()};
    try{await request(path,{method,body:{...body,requestId:command.current.id}});command.current=null;setDirty(false);setPanel('');if(['generate','save','publish','revise'].includes(kind))setView('roster');else if(['close','reopen'].includes(kind))setView('auto');await load(taskId);await loadTasks();setNotice(({save:'调整已保存，已重新校验。',publish:'班表已发布，成员端将显示最新安排。',close:'收集已结束，可以生成自动排班。',reopen:'收集已重新开放，现有班表保持不变。',generate:'已生成排班草稿，请处理缺口并核对安排。',revise:'已复制当前班表。修订发布前，原班表继续生效。',series:'收集设置已更新。',participants:'参与人员已增补。'})[kind]);}
    catch(failure){setError(failure.message);}finally{lock.current=false;setBusy(false);}
  }
  async function openParticipants() {
    setError('');
    try{const result=await request('/api/roster-tasks/candidates',{method:'POST',body:task});setExtraPeople(result.items.filter(item=>!task.memberIds.includes(item.memberId)));setAddedPeople([]);setPanel('participants');}catch(failure){setError(failure.message);}
  }
  const change=next=>{serial.current++;readController.current?.abort();setRows(next);setDirty(true);setNotice('');};
  const members=data?.members||[],slots=data?.slots||[],names=new Map(members.map(item=>[item.memberId,item.name]));
  const protectedRows=data?.protectedAssignments||[];
  const protectedPerson=row=>protectedRows.some(item=>item.memberId===row.memberId&&item.businessDate===row.businessDate);
  const selectedAssignment=choosing?.memberId&&rows.find(row=>row.memberId===choosing.memberId&&key(row)===(choosing.sourceKey||key(choosing.slot)));
  function assign(member,slot,override=false) {
    if(selectedAssignment&&protectedPerson(selectedAssignment))return;
    if(rows.some(row=>row.memberId===member.memberId&&(!office||row.businessDate===slot.businessDate)&&protectedPerson(row)))return;
    const reported=member.available.some(item=>key(item)===key(slot));
    const moving=selectedAssignment&&key(selectedAssignment)!==key(slot)?[selectedAssignment]:[];
    const replacing=choosing?.replaceId&&names.get(choosing.replaceId);
    if(!override&&(!reported||moving.length||replacing)){setConfirmOverride({member,slot,reported,moving,replacing});return;}
    const retained=rows.filter(row=>!moving.includes(row)&&!(choosing?.replaceId===row.memberId&&key(row)===key(slot)));
    change([...retained,{...slot,memberId:member.memberId,roleKind:office?selectedAssignment?.roleKind||'':member.pool==='lead'?'repair_lead':'',manualOverride:!reported,locked:selectedAssignment?.locked||false}]);
    if(choosing?.memberId)setChoosing(current=>({...current,sourceKey:key(slot)}));
    setConfirmOverride(null);
  }
  const previous=data?.publishedAssignments||[];
  const signature=row=>`${row.memberId}:${key(row)}:${row.roleKind||''}`;
  const differences=[...previous.filter(row=>!rows.some(item=>signature(item)===signature(row))).map(row=>({row,kind:'移除'})),...rows.filter(row=>!previous.some(item=>signature(item)===signature(row))).map(row=>({row,kind:'安排'}))];
  const unassigned=members.filter(member=>!rows.some(row=>row.memberId===member.memberId));
  const candidateSlots=member=>member.manualSlots||member.available;
  const collectionView=view==='collection'||view==='auto'&&collecting;
  const stage=collecting&&!collectionView&&draft ? draft.status==='draft' ? data?.publishedVersion?'revising':'adjusting' : 'published' : data?.stage||'ready';
  const showBoard=manage&&!!draft&&!collectionView;
  const assignmentCount=member=>rows.filter(row=>row.memberId===member.memberId).length;
  const visibleCandidates=choosing?[...members].sort((a,b)=>assignmentCount(a)-assignmentCount(b)||a.name.localeCompare(b.name,'zh-CN')).filter(member=>(!choosing.memberId||member.memberId===choosing.memberId)&&member.name.includes(query)&&(candidatePool==='all'||office||choosing.memberId||member.pool===candidatePool)&&(showConflicts||choosing.memberId||candidateSlots(member).some(slot=>key(slot)===key(choosing.slot)))):[];
  return <section className="react-page roster-workflow">
    <WorkspaceHeader group="值班管理" title={office?'办公排班管理':'维修排班管理'} description="收集整周可用时间，自动排班后人工核对，再发布给成员。">{canCreate&&<button disabled={busy||dirty||requirementsDirty} onClick={()=>setCreating(true)}>{office?'新建办公收集任务':'新建收集任务'}</button>}</WorkspaceHeader>
    <div className="roster-range"><CollectionScope tasks={tasks} taskId={taskId} onChange={setTaskId} management disabled={busy||dirty||requirementsDirty}/><div className="roster-range-actions"><button disabled={!taskId||busy||dirty||requirementsDirty||loading} onClick={async()=>{try{await loadTasks();await load(taskId);}catch(failure){setError(failure.message);}}}>刷新</button>{task?.actions?.configure&&<button disabled={dirty||busy||requirementsDirty||loading||!data} onClick={()=>setPanel('settings')}>任务设置</button>}</div></div>
    {task?.collectionIssue&&<p role="status" className="react-message">{task.collectionIssue}</p>}{error&&<p role="alert" className="react-error">{error}</p>}{notice&&<p role="status" className="react-message">{notice}</p>}
    {!taskId&&<section className="roster-start"><strong>{'从发布可用时间收集开始'}</strong><p>{'在同一任务中设置参与校区、成员和每天的人数。成员提交后，再结束收集并生成班表。'}</p>{canCreate?<button className="field-primary" onClick={()=>setCreating(true)}>{'发布收集任务'}</button>:<p>暂无可配置任务，请联系维修排班负责人发布收集。</p>}</section>}
    {loading&&!data&&<div className="roster-loading" role="status">正在读取本周安排…</div>}
    {data&&manage&&<><div className="roster-view-tabs" role="tablist" aria-label="本周工作内容"><button role="tab" aria-selected={collectionView} onClick={()=>setView('collection')} disabled={dirty||busy}>收集进度</button><button role="tab" aria-selected={!collectionView} onClick={()=>setView('roster')} disabled={busy||!draft}>班表与调整</button>{!draft&&<span>结束收集并自动排班后，在这里调整班表</span>}</div><RosterStage office={office} stage={stage}/><section className="roster-next"><div><span className="react-eyebrow">{task.weekStart} 起 · {task.slotStart}–{task.slotEnd}</span><h2>{({scheduled:'本周收集尚未开放',collecting:'正在收集可用时间',ready:'收集已结束，可以自动排班',adjusting:'核对并调整班表',revising:'正在修订已发布班表',published:'班表已发布'})[stage]}</h2><p>{stage==='scheduled'?`将于 ${new Date(task.collectionOpensAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} 开放本周填报。`:collecting&&collectionView?`${data.progress.submitted} / ${data.progress.total} 人已提交 · 截止 ${new Date(task.deadline).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`:stage==='published'?'成员正在使用当前班表。修改时先建立修订稿，确认后再发布。':dirty?'有未保存调整，请先保存并校验。':data.publishedVersion?'原班表继续生效，修订发布后才会替换。':'完成覆盖和资格检查后，成员才能看到班次。'}</p></div><div>
      {collecting&&collectionView&&<button className="field-primary" disabled={busy||dirty} onClick={()=>setPanel('close')}>结束收集</button>}
      {stage==='ready'&&<button className="field-primary" disabled={busy||data.requiresRuleConfirmation} onClick={()=>run('generate','/api/rosters/generate',{taskId})}>{'生成自动排班'}</button>}
      {stage==='published'&&<button className="field-primary" disabled={busy} onClick={()=>run('revise',`/api/roster-tasks/${taskId}/revision`,{publishedVersionId:data.publishedVersion.id})}>调整已发布班表</button>}
      {editable&&!collectionView&&<span className="roster-edit-hint">{dirty?'调整尚未保存':'可点击人员调整，或在日期下添加人员'}</span>}
    </div></section>
    {collectionView&&<section className="roster-collection"><div className="roster-section-title"><h2>收集情况</h2><span>填报人数反映已提交，不代表一定可覆盖全部班次</span></div><progress max={Math.max(1,data.progress.total)} value={data.progress.submitted} aria-label="填报进度"/><div className="roster-coverage">{data.progress.coverage.map(slot=><article key={key(slot)}><strong>{label(slot)}</strong>{!office&&<span>负责人可用 {slot.leads} / 需 1 名</span>}<span>{office?'办公':'普通'}人员可用 {slot.ordinary} / {office?'目标':'最低'} {slot.ordinaryMinimum ?? 1} 名</span></article>)}</div><details><summary>查看成员填报情况 · {data.progress.total-data.progress.submitted} 人未提交</summary><ul className="roster-progress-people">{data.progress.people.map(person=><li key={person.memberId}><strong>{person.name}</strong><span>{!person.active?'资格或账号已变化':!person.submission?'尚未提交':person.submission.unavailable?'整周无法参加':'已提交可用时间'}</span></li>)}</ul></details>{data.publishedVersion&&<p className="react-muted">此次重新收集不改变当前有效班表。</p>}</section>}
    {!collecting&&stage!=='scheduled'&&<div className="roster-secondary-actions"><WorkspaceMoreActions label="收集与排班操作"><button disabled={busy||dirty} onClick={()=>{setReopenDeadline(`${addDays(dateKey(),1)}T18:00`);setPanel('reopen');}}>重新开放收集</button>{editable&&<button disabled={busy||dirty} onClick={()=>setPanel('regenerate')}>重新自动排班</button>}</WorkspaceMoreActions></div>}
    {showBoard&&<><div className="roster-board-heading"><h2>{editable?'班表草稿':'当前有效班表'}</h2><span>{rows.length} 班 · {new Set(rows.map(row=>row.memberId)).size} 人</span>{dirty&&<button onClick={()=>{setRows(draft.assignments);setDirty(false);}}>撤销未保存调整</button>}</div>
    <div className="roster-mobile-days" aria-label="选择值班日期">{days.map((day,i)=><button key={day} aria-pressed={mobileDay===i} onClick={()=>setMobileDay(i)}>{day}<small>{addDays(task.weekStart,i).slice(5)}</small></button>)}</div>
    <div className="roster-board-layout" inert={busy || undefined} aria-busy={busy}><div className="roster-campus-boards">{[...new Set(slots.map(slot=>slot.campusId))].map(campusId=><section className="roster-campus-board" key={campusId}><h3>{campuses[campusId]}</h3><div className="roster-week-columns">{slots.filter(slot=>slot.campusId===campusId).map((slot,index)=>{
      const assigned=rows.filter(row=>key(row)===key(slot)),effective=assigned.filter(row=>row.leaveStatus!=='approved');
      const leads=effective.filter(row=>row.roleKind==='repair_lead').length,ordinary=effective.length-leads;
      return <article className="roster-day-column" data-visible={mobileDay===index} key={key(slot)} onDragOver={event=>{if(editable)event.preventDefault();}} onDrop={event=>{event.preventDefault();const member=members.find(item=>item.memberId===event.dataTransfer.getData('text/plain'));if(member&&candidateSlots(member).some(item=>key(item)===key(slot)))assign(member,slot);}}><header><strong>{days[index]}</strong><span>{slot.businessDate.slice(5)}</span></header><p className="roster-coverage-caption">{office?`已排 ${effective.length} / 目标 ${slot.ordinaryMinimum ?? 1} 人`:`负责人 ${leads}/1 · 普通 ${ordinary}/${slot.ordinaryMinimum ?? 1}`}</p>
        {!office&&(leads!==1||ordinary<(slot.ordinaryMinimum??1))&&<span className="roster-gap">{leads!==1?'负责人需处理':'普通人员缺额'}</span>}
        {(office?[{title:'办公人员',items:assigned}]:[{title:'值班负责人',items:assigned.filter(row=>row.roleKind==='repair_lead')},{title:'普通维修人员',items:assigned.filter(row=>row.roleKind!=='repair_lead')}]).map(group=><section className="roster-role-group" key={group.title}><h4>{group.title}<span>{group.items.length} 人</span></h4><ul>{group.items.map(row=><RosterAssignment key={row.memberId} row={row} member={members.find(item=>item.memberId===row.memberId)} editable={editable} protectedRow={protectedPerson(row)} onEdit={()=>{setQuery('');setCandidatePool('all');setShowConflicts(false);setChoosing(row.leaveStatus==='approved'?{slot,supplementFor:names.get(row.memberId)||'请假成员'}:{slot,memberId:row.memberId,sourceKey:key(row)});}}/>)}</ul>{!group.items.length&&<p className="roster-empty-slot">尚未安排</p>}</section>)}
        {editable&&<button className="roster-add-person" disabled={busy} onClick={()=>{setQuery('');setCandidatePool('all');setShowConflicts(false);setChoosing({slot});}}>添加{office?'办公':'维修'}人员</button>}
      </article>;
    })}</div></section>)}</div><aside className="roster-unassigned"><h3>{office?'人员班次数':'尚未安排'}</h3><p className="react-muted">{office?'同一成员每日一班。选择日期下的添加按钮安排人员。':'负责人可以本周不排班。普通人员未安排的问题需在发布前处理。'}</p><label className="workspace-search-label">查找待安排人员<input type="search" value={poolQuery} onChange={event=>setPoolQuery(event.target.value)} placeholder="输入姓名"/></label><div className="roster-pool-list">{(office?[...members].sort((a,b)=>assignmentCount(a)-assignmentCount(b)||a.name.localeCompare(b.name,'zh-CN')):unassigned).filter(member=>member.name.includes(poolQuery.trim())).map(member=><div className="roster-unassigned-person" key={member.memberId} draggable={editable} onDragStart={event=>event.dataTransfer.setData('text/plain',member.memberId)}><strong>{member.name}</strong><StaffIdentity identities={member.identities}/><small>{office?`本周已排 ${rows.filter(row=>row.memberId===member.memberId).length} 班 · `:''}{member.available.length?'已填报可参加时间':'暂无完整班次填报'}</small>{editable&&<button onClick={()=>{setQuery('');setCandidatePool('all');setShowConflicts(false);setChoosing({memberId:member.memberId,slot:slots[0]});}}>安排到日期</button>}</div>)}</div>{!(office?members:unassigned).length&&<p className="react-muted">本周参与人员均已安排。</p>}</aside></div>
    {draft.sourceChanged&&!dirty&&<p role="status" className="react-message">任务或人员数据已变化。请核对安排后保存并重新校验。<button onClick={()=>setDirty(true)}>核对当前班表</button></p>}
    {!!draft.validation.errors.length&&!dirty&&<section className="roster-issues"><h3>发布前需要处理</h3><ul>{draft.validation.errors.map((issue,i)=><li key={i}><span>{names.get(issue.memberId)||''} {issueLabels[issue.code]||'安排需要核对'} {issue.slot?label(issue.slot):''}</span>{editable&&issue.slot&&<button onClick={()=>setChoosing({slot:issue.slot})}>处理此班次</button>}</li>)}</ul></section>}
    {editable&&<div className="roster-editbar"><div><strong>{dirty?'有未保存的调整':draft.validation.valid?'班表检查通过':'先处理下方检查问题'}</strong><span>当前有效班表会保留到新版本发布</span></div><div>{dirty&&<button disabled={busy} onClick={()=>{setRows(draft.assignments);setDirty(false);}}>撤销本次修改</button>}{dirty?<button className="field-primary" disabled={busy} onClick={()=>run('save',`/api/rosters/${draft.id}`,{version:draft.version,assignments:rows},'PATCH')}>保存并校验</button>:<button className="field-primary" disabled={busy||!draft.validation.valid||draft.sourceChanged} onClick={()=>setPanel('publish')}>检查并发布</button>}</div></div>}
    </>}
    </>}
    {data&&!manage&&<section className="roster-start"><h2>收集任务设置</h2><p>你可以配置授权校区每日需求。收集、人员安排与发布由维修排班负责人处理。</p><RequirementEditor taskId={taskId} onDirty={setRequirementsDirty}/></section>}
    {creating&&<CollectionComposer office={office} onClose={()=>setCreating(false)} onCreated={id=>{setCreating(false);loadTasks(id).catch(failure=>setError(failure.message));setNotice('收集任务已发布，成员现在可以填报时间。');}}/>}
    {panel==='participants'&&<Modal title="增补参与人员" onClose={()=>setPanel('')}><p>增补加入当前周。已有填报和班表不会自动改变；需要用于以后各周时，请在每周开放设置中明确应用。</p><div className="roster-choice-row">{extraPeople.map(person=><label key={person.memberId}><input type="checkbox" checked={addedPeople.includes(person.memberId)} onChange={()=>setAddedPeople(current=>current.includes(person.memberId)?current.filter(id=>id!==person.memberId):[...current,person.memberId])}/>{person.name}<StaffIdentity identities={person.identities}/></label>)}</div>{!extraPeople.length&&<p>当前范围没有其他符合资格的人员。</p>}{error&&<p role="alert" className="react-error">{error}</p>}<div className="roster-modal-actions"><button onClick={()=>setPanel('')}>取消</button><button className="field-primary" disabled={busy||!addedPeople.length} onClick={()=>run('participants',`/api/roster-tasks/${taskId}/participants`,{revision:task.revision,memberIds:addedPeople})}>确认增补</button></div></Modal>}
    {panel==='automation'&&data?.series&&<Modal title="收集任务设置" onClose={()=>setPanel('')}><CollectionSettings series={data.series} task={task} busy={busy} error={error} onSave={input=>run('series',`/api/roster-series/${data.series.id}`,input,'PATCH')}/></Modal>}
    {panel==='settings'&&<Modal title="本周人数与参与名单" onClose={()=>{if(!requirementsDirty)setPanel('');}}><p>{task.weekStart} · {task.description||'本周可用时间收集'}</p><RequirementEditor taskId={taskId} onDirty={setRequirementsDirty} onSaved={()=>load(taskId)}/>{requirementsDirty&&<p className="react-message">有未保存的需求调整。<button onClick={()=>{setRequirementsDirty(false);setPanel('');}}>放弃修改并关闭</button></p>}{manage&&<button disabled={busy||requirementsDirty} onClick={openParticipants}>增补参与人员</button>}{data?.series&&<button disabled={busy||requirementsDirty} onClick={()=>setPanel('automation')}>每周循环收集设置</button>}</Modal>}
    {['close','reopen','regenerate','publish'].includes(panel)&&<Modal title={({close:'结束本次收集',reopen:'重新开放收集',regenerate:'重新生成自动排班',publish:'检查并发布班表'})[panel]} onClose={()=>{if(!busy)setPanel('');}}><div className="roster-confirm">
      {panel==='close'&&<><p>{data.progress.submitted} / {data.progress.total} 人已提交。结束后成员将不能修改填报。</p>{data.progress.people.filter(item=>!item.submission).length>0&&<p className="roster-gap">尚未提交：{data.progress.people.filter(item=>!item.submission).map(item=>item.name).join('、')}</p>}</>}
      {panel==='reopen'&&<><p>保留已填报时间和当前班表。新的提交不会自动改变安排。</p><label>新的截止时间<input type="datetime-local" required value={reopenDeadline} onChange={event=>setReopenDeadline(event.target.value)}/></label></>}
      {panel==='regenerate'&&<p>重新计算尚未锁定的安排。锁定的人工安排会保留，原已发布班表继续生效。</p>}
      {panel==='publish'&&<><p>{task.weekStart} 起 · {task.campusScope.campusIds.map(id=>campuses[id]).join('、')}</p><p>{rows.length} 班，{new Set(rows.map(row=>row.memberId)).size} 人。以下变化确认后才生效。</p><ul className="roster-diff">{differences.map(({row,kind},i)=><li key={i}><span>{kind}</span><strong>{names.get(row.memberId)||'成员'}</strong><span>{label(row)}</span>{row.manualOverride&&<small>人工安排，超出原填报</small>}</li>)}</ul><p>发布时将再次核对资格、人数、签到和班次冲突。</p></>}
      {error&&<p role="alert" className="react-error">{error}</p>}<div className="roster-modal-actions"><button disabled={busy} onClick={()=>setPanel('')}>返回核对</button><button className="field-primary" disabled={busy||panel==='reopen'&&(!reopenDeadline||!Number.isFinite(Date.parse(reopenDeadline)))} onClick={()=>panel==='publish'?run('publish',`/api/rosters/${draft.id}/publish`,{version:draft.version}):panel==='regenerate'?run('generate','/api/rosters/generate',{taskId}):run(panel,`/api/roster-tasks/${taskId}/collection`,{action:panel,revision:task.revision,...(panel==='reopen'?{deadline:new Date(reopenDeadline).toISOString()}:{})})}>{({close:'确认结束收集',reopen:'重新开放',regenerate:'重新生成',publish:'确认发布'})[panel]}</button></div>
    </div></Modal>}
    {choosing&&<Modal title={choosing.supplementFor?'安排补位人员':choosing.memberId?'调整人员安排':`安排 ${label(choosing.slot)}`} onClose={()=>{setChoosing(null);setConfirmOverride(null);}}><div className="roster-picker">{choosing.supplementFor&&<p role="status">为 {choosing.supplementFor} 安排补位人员。原请假班次与审批记录会保留，不计入在岗人数。</p>}{selectedAssignment&&<RosterAssignmentControls row={selectedAssignment} member={members.find(member=>member.memberId===selectedAssignment.memberId)} office={office} onChange={updated=>change(rows.map(row=>row===selectedAssignment?updated:row))} onReplace={()=>{setConfirmOverride(null);setQuery('');setCandidatePool('all');setShowConflicts(false);setChoosing({slot:selectedAssignment,replaceId:selectedAssignment.memberId});}} onRemove={()=>{change(rows.filter(row=>row!==selectedAssignment));setConfirmOverride(null);setChoosing(null);}}/>}<label>目标班次<select aria-label="目标班次" disabled={!!choosing.supplementFor} value={key(choosing.slot)} onChange={event=>{setChoosing(current=>({...current,slot:slots.find(slot=>key(slot)===event.target.value)}));setConfirmOverride(null);}}>{slots.map(slot=><option value={key(slot)} key={key(slot)}>{label(slot)}</option>)}</select></label><label>查找成员<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入姓名"/></label><p className="react-muted">先选目标日期，再添加人员。会清楚提示原班次和未填报的时间。</p>{!choosing.memberId&&<div className="roster-candidate-filters">{!office&&<div role="group" aria-label="人员名额">{[['all','全部'],['lead','负责人'],['ordinary','普通维修']].map(([value,text])=><button key={value} aria-pressed={candidatePool===value} onClick={()=>setCandidatePool(value)}>{text}</button>)}</div>}<label><input type="checkbox" checked={showConflicts} onChange={event=>setShowConflicts(event.target.checked)}/>显示不可安排人员</label></div>}<div className="roster-candidates">{visibleCandidates.map(member=>{
      const eligible=candidateSlots(member).some(slot=>key(slot)===key(choosing.slot)),reported=member.available.some(slot=>key(slot)===key(choosing.slot));
      const same=rows.some(row=>row.memberId===member.memberId&&key(row)===key(choosing.slot)),protectedMember=rows.some(row=>row.memberId===member.memberId&&(!office||row.businessDate===choosing.slot.businessDate)&&protectedPerson(row));
      return <article className="roster-candidate" key={member.memberId}><div><strong>{member.name}</strong><StaffIdentity identities={member.identities}/><small>{assignmentCount(member)?`本周已安排 ${assignmentCount(member)} 班`:'本周尚未安排 · 优先'}</small>{rows.some(row=>row.memberId===member.memberId&&key(row)!==key(choosing.slot))&&<p>当前安排：{rows.filter(row=>row.memberId===member.memberId).map(label).join('、')}</p>}<RosterReportedTimes windows={member.reportedWindows} title="原填报时间"/><RosterReportedTimes windows={member.existingAssignments} title="已有其他班次"/><span>{!eligible?'此班次资格、授权或已有安排冲突':protectedMember?'原班次已签到或结束':same?'已在本班次':reported?'可安排':'未填报此时段 · 可人工安排'}</span></div><button disabled={!eligible||protectedMember||same} onClick={()=>assign(member,choosing.slot)}>{selectedAssignment?'移动到本班次':choosing.replaceId?'替换此班次':assignmentCount(member)?'额外安排':'添加'}</button></article>;
    })}{!visibleCandidates.length&&<p className="roster-empty-slot" role="status">当前条件没有可安排的成员。可切换身份、清空姓名或显示不可安排人员查看原因。</p>}</div>{confirmOverride&&<section className="roster-override-confirm" role="alert"><p>{confirmOverride.member.name} 将安排至 {label(confirmOverride.slot)}。{confirmOverride.moving.length>0&&<>原安排 {confirmOverride.moving.map(label).join('、')} 将移除。</>}{confirmOverride.replacing&&<>将替换 {confirmOverride.replacing}。</>}{!confirmOverride.reported&&<>此时段未填报可参加，将记录为人工安排，原填报不变。</>}</p><button onClick={()=>setConfirmOverride(null)}>取消</button><button className="field-primary" onClick={()=>assign(confirmOverride.member,confirmOverride.slot,true)}>确认人工安排</button></section>}<div className="roster-modal-actions"><button className="field-primary" onClick={()=>{setChoosing(null);setConfirmOverride(null);}}>完成调整</button></div></div></Modal>}
  </section>;
}
