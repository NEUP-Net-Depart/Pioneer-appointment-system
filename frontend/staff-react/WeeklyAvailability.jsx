import React,{useContext,useEffect,useRef,useState} from 'react';
import {request} from './request.js';
import {ActivityContext} from './field/ui';
import {CollectionScope} from './CollectionScope';
import {preferredRosterPeriod} from '../../shared/roster-collections.js';
import {fullDutyWindows} from '../../shared/duty-window.js';
import {addDays} from '../../shared/time.js';
import {useUnsavedChanges} from './useUnsavedChanges.js';
const campusNames={'campus-nanhu':'南湖','campus-hunnan':'浑南'};
export function WeeklyAvailability({tasks}) {
  const active=useContext(ActivityContext),[taskId,setTaskId]=useState(''),[windows,setWindows]=useState([]),[unavailable,setUnavailable]=useState(false);
  const [submission,setSubmission]=useState(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [autoContinue,setAutoContinue]=useState(false),[preferences,setPreferences]=useState([]);
  const [selectableSlots,setSelectableSlots]=useState([]),[reload,setReload]=useState(0);
  const savedSelection=useRef({windows:[],unavailable:false,autoContinue:false});
  const controller=useRef(null),lock=useRef(false),command=useRef(null),task=tasks.find(item=>item.id===taskId);
  useEffect(()=>{if(dirty)return;const current=tasks.find(item=>item.id===taskId);if(current?.actions?.fill)return;const preferred=preferredRosterPeriod(tasks)?.id||'';if(preferred!==taskId)setTaskId(preferred);},[tasks,taskId,dirty]);
  useEffect(()=>{if(active)request('/api/me/availability-preferences').then(result=>setPreferences(result.items)).catch(failure=>setError(failure.message));},[active]);
  useEffect(()=>{
    if(!taskId)return;const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
    request(`/api/roster-tasks/${taskId}/availability`,{signal:abort.signal}).then(result=>{if(abort.signal.aborted)return;const restored=fullDutyWindows(result.items,task).filter(row=>(result.selectableSlots||[]).some(slot=>slot.businessDate===row.businessDate&&slot.campusId===row.campusId));setWindows(restored);savedSelection.current={windows:restored,unavailable:!!result.submission?.unavailable,autoContinue:result.autoContinue};setSelectableSlots(result.selectableSlots||[]);setSubmission(result.submission);setAutoContinue(result.autoContinue);setUnavailable(!!result.submission?.unavailable);setDirty(false);setNotice(result.items.some(row=>row.startAt>task.slotStart||row.endAt<task.slotEnd)?'原填报包含不足整次值班的时间，请重新勾选完整日期并提交。':'');}).catch(failure=>{if(!abort.signal.aborted)setError(failure.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[taskId,reload]);
  const navigationForm=useUnsavedChanges({dirty,active,busy,save:submit,discard:()=>{setWindows(savedSelection.current.windows);setUnavailable(savedSelection.current.unavailable);setAutoContinue(savedSelection.current.autoContinue);setDirty(false);setError('');command.current=null;}});
  function toggle(day,campusId) {
    setWindows(current=>current.some(row=>row.businessDate===day&&row.campusId===campusId)?current.filter(row=>row.businessDate!==day||row.campusId!==campusId):[...current,{businessDate:day,campusId,startAt:task.slotStart,endAt:task.slotEnd}]);
    setDirty(true);setUnavailable(false);setNotice('');
  }
  async function submit(event) {
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
    const body={windows:unavailable?[]:windows.map(({businessDate,campusId,startAt,endAt})=>({businessDate,campusId,startAt,endAt})),unavailable,autoContinue,revision:submission?.revision ?? -1};
    const signature=JSON.stringify(body);if(command.current?.signature!==signature)command.current={signature,id:crypto.randomUUID()};
    try{if(!task?.actions?.fill||!unavailable&&!windows.length){setError('请选择可参加日期或整周无法参加。');return false;}const result=await request(`/api/roster-tasks/${taskId}/submission`,{method:'PUT',body:{...body,requestId:command.current.id}});savedSelection.current={windows:result.items,unavailable,autoContinue};setWindows(result.items);setSubmission(result.submission);setDirty(false);command.current=null;setNotice('整周可用时间已提交，截止前可以修改。');setPreferences((await request('/api/me/availability-preferences')).items);return true;}
    catch(failure){setError(failure.message);}finally{lock.current=false;setBusy(false);}
  }
  return <section className="weekly-availability"><h2>填报整周可用时间</h2>{preferences.filter(item=>item.enabled).map(item=><div className="react-message" key={item.duty_type}><span>{item.duty_type==='office'?'办公':'维修'}可用时间自动延续已开启</span><button disabled={busy} onClick={()=>request('/api/me/availability-preferences',{method:'PATCH',body:{dutyType:item.duty_type,enabled:false}}).then(result=>{setPreferences(result.items);if(task?.dutyType===item.duty_type){setAutoContinue(false);savedSelection.current={...savedSelection.current,autoContinue:false};}}).catch(failure=>setError(failure.message))}>关闭后续自动延续</button></div>)}{!tasks.length?<div className="empty-state"><strong>暂无开放任务</strong><span>负责人发布收集任务后，这里会出现整周填报入口。</span></div>:<form ref={navigationForm} onSubmit={submit}>
    <CollectionScope tasks={tasks} taskId={taskId} onChange={setTaskId} disabled={busy||dirty}/>
    {task&&<>{task.collectionIssue&&<p className="react-message" role="status">{task.collectionIssue}</p>}{!task.actions?.fill&&<p className="react-message" role="status">{task.collectionState==='scheduled'?'本周填报尚未开放，请在开放时间后填写。':'当前周收集已结束，可查看原填报。开放下一周时仍从这个任务填写。'}</p>}<p className="react-muted">勾选可以参加的日期和校区，一次提交。截止 {new Date(task.deadline).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p><label className="roster-choice-row"><input type="checkbox" checked={unavailable} disabled={busy||!task.actions?.fill} onChange={event=>{setUnavailable(event.target.checked);setDirty(true);}}/>整周无法参加</label>
      {!selectableSlots.length&&<p className="react-message">本周没有可参加的服务日（暂停或范围已变化），可提交整周无法参加。</p>}<fieldset disabled={busy||unavailable||!task.actions?.fill}>{Array.from({length:4},(_,i)=>addDays(task.weekStart,i)).map((day,index)=><section className="weekly-day" key={day}><h3>{['周一','周二','周三','周四'][index]} · {day.slice(5)}</h3>{task.campusScope.campusIds.filter(campusId=>selectableSlots.some(slot=>slot.businessDate===day&&slot.campusId===campusId)).map(campusId=>{
        const window=windows.find(row=>row.businessDate===day&&row.campusId===campusId);
        return <div key={campusId}><label className="weekly-campus"><input type="checkbox" checked={!!window} onChange={()=>toggle(day,campusId)}/>{campusNames[campusId]}校区</label>{window&&<p className="react-muted">完整值班 · {task.slotStart}–{task.slotEnd}</p>}</div>;
      })}</section>)}</fieldset>
      <label className="roster-choice-row"><input type="checkbox" checked={autoContinue} disabled={busy||!task.actions?.fill} onChange={event=>{setAutoContinue(event.target.checked);setDirty(true);}}/>后续同岗位收集自动延续本周选择</label><p className="react-muted">按星期和校区带入后续任务的完整班次。自动延续仍会检查资格和任务范围，不覆盖已经提交的内容，可随时关闭。</p>
      {submission&&<p className="react-muted">{submission.source==='carried'?'本周由自动延续提交':'上次手动提交'}：{new Date(submission.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>}{error&&<p role="alert" className="react-error">{error}</p>}{notice&&<p role="status" className="react-message">{notice}</p>}<div className="field-actions">{dirty&&<button type="button" disabled={busy} onClick={()=>{setDirty(false);setReload(value=>value+1);}}>放弃本次修改</button>}<button className="field-primary" disabled={busy||!task.actions?.fill||!dirty||!unavailable&&!windows.length}>提交整周可用时间</button></div>
    </>}
  </form>}{!task&&dirty&&<p role="alert" className="react-error">本任务已结束或填报资格已变化。输入仍保留，可联系负责人重新开放收集。<button type="button" onClick={()=>{setDirty(false);setTaskId(preferredRosterPeriod(tasks)?.id || '');}}>放弃本次未提交内容</button></p>}{!tasks.length&&error&&<p role="alert" className="react-error">{error}</p>}</section>;
}
