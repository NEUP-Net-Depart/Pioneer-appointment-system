import React, {useEffect,useState} from 'react';
import {request} from './request.js';

// Creation options are evaluated by the server. The browser never reconstructs
// combinations of campus/department grants from a broad capability flag.
export function RosterScopeFields({dutyType,value,onChange,onReady,disabled}) {
  const [items,setItems] = useState([]), [loading,setLoading] = useState(true), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  const [all,setAll] = useState(false);
  const campus = items.find(item => item.campusId === value.campusId);
  const selected = value.departmentIds || [];
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); onReady(false);
    request(`/api/roster-tasks/options?dutyType=${encodeURIComponent(dutyType)}`,{signal:controller.signal}).then(result => {
      if (controller.signal.aborted) return;
      const options = result.items || [], initial = options.find(item => item.campusId === value.campusId) || options[0];
      setItems(options);
      if (initial) {
        const preserved = (value.departmentIds || []).filter(id => initial.departments.some(item => item.id === id));
        const allDepartments = initial.allDepartments && !preserved.length;
        const departmentIds = allDepartments ? [] : preserved.length ? preserved : [initial.departments[0].id];
        setAll(allDepartments); onChange({campusId:initial.campusId,departmentIds}); onReady(true);
      }
    }).catch(failure => {if (!controller.signal.aborted) setError(failure.message);})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  },[dutyType,retry]);
  function chooseCampus(campusId) {
    const next = items.find(item => item.campusId === campusId);
    setAll(next.allDepartments);
    onChange({campusId,departmentIds:next.allDepartments ? [] : [next.departments[0].id]}); onReady(true);
  }
  function toggle(id) {
    const next = all ? [id] : selected.includes(id) ? selected.filter(value => value !== id) : [...selected,id];
    setAll(false); onChange({departmentIds:next}); onReady(next.length > 0);
  }
  return <>
    {loading && <p role="status" className="react-muted">正在读取可管理的校区与部门…</p>}
    {error && <div role="alert" className="react-error">{error}<button type="button" onClick={() => setRetry(value => value+1)}>重试</button></div>}
    {!loading && !error && !items.length && <p role="status">当前授权不支持新建任务，请联系管理员调整管理范围。</p>}
    {!!items.length && !loading && <><label>校区<select required value={value.campusId} disabled={disabled} onChange={event => chooseCampus(event.target.value)}>{items.map(item => <option key={item.campusId} value={item.campusId}>{item.name}</option>)}</select></label>
      <fieldset className="roster-scope-fields" disabled={disabled}><legend>参与部门</legend><div className="roster-scope-options">
        {campus?.allDepartments && <button type="button" aria-pressed={all} onClick={() => {setAll(true); onChange({departmentIds:[]}); onReady(true);}}>全部部门</button>}
        {campus?.departments.map(item => <button type="button" key={item.id} aria-pressed={!all && selected.includes(item.id)} onClick={() => toggle(item.id)}>{item.name}</button>)}
      </div><p className="react-muted">{all ? '可安排所选校区内的所有部门成员。' : selected.length ? '仅安排所选部门的成员，按班次发生时的任职判断。' : '请至少选择一个部门。'}</p></fieldset></>}
  </>;
}
