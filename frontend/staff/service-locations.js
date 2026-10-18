import { $,escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { dateKey,formatInstant } from '/shared/time.js';
export function initServiceLocations() {
  const panel=$('#location-settings'),form=$('#location-form'),campus=$('#location-campus'),date=$('#location-date'),location=$('#location-value'),message=$('#location-message');
  let actor,generation=0,revision=0,selection='',savedValue='',saving=false;
  date.value=dateKey();
  function showDetails(result){$('#location-affected').innerHTML=result.affectedAppointments?.length ? `<p><strong>${result.affectedAppointments.length} 条当前预约需要人工通知。</strong>系统不会自动发送消息。</p><ul>${result.affectedAppointments.map(item=>`<li>${escapeHtml(item.id)} · ${escapeHtml(item.name)} · ${escapeHtml(item.contactValue ? (item.contactType==='qq' ? 'QQ ' : '微信 ')+item.contactValue : item.social || item.phone)}${item.email ? ' · '+escapeHtml(item.email) : ''}</li>`).join('')}</ul>` : '<p>没有需要通知的当前预约。</p>';
    $('#location-history').innerHTML=(result.changes || []).map(item=>`<p>${escapeHtml(formatInstant(item.createdAt))} · ${escapeHtml(item.actor)} · ${escapeHtml(item.beforeLocation || '未配置')} → ${escapeHtml(item.afterLocation || '未配置')}（版本 ${item.revision}）</p>`).join('') || '<p>暂无变更记录。</p>';
  }
  async function read(){if(!actor || saving || !date.value)return;const current=++generation;const selected=`${campus.value}/${date.value}`;message.textContent='正在读取地点…';
    try{const result=await apiJson('/api/service-locations?'+new URLSearchParams({dateFrom:date.value,dateTo:date.value}));if(current!==generation)return;const item=result.items.find(item=>item.campus===campus.value);revision=item?.revision || 0;selection=selected;savedValue=location.value=item?.location || '';message.textContent=item ? `地点版本 ${revision}` : '未配置地点，这一天不能新建学生预约。';const details=await apiJson('/api/service-locations/history?'+new URLSearchParams({campus:campus.value,date:date.value}));if(current===generation)showDetails(details);}
    catch(error){if(current===generation)message.textContent=error.message;}
  }
  form.addEventListener('submit',async event=>{event.preventDefault();if(saving)return;if(selection!==`${campus.value}/${date.value}`){message.textContent='请先读取所选校区与日期的最新地点。';return;}saving=true;const current=++generation;form.querySelectorAll('button,input,select').forEach(control=>control.disabled=true);
    try{const item=await apiJson('/api/service-locations',{method:'PATCH',json:{campus:campus.value,date:date.value,location:location.value,revision}});if(current!==generation)return;revision=item.revision;savedValue=location.value=item.location;message.textContent='地点已保存。已有预约会显示最新地点，请人工通知受影响学生。';showDetails(item);}
    catch(error){if(current===generation)message.textContent=error.message+'。输入已保留。';}
    finally{if(current===generation){saving=false;form.querySelectorAll('button,input,select').forEach(control=>control.disabled=false);}}
  });
  $('#location-read').addEventListener('click',()=>void read());
  campus.addEventListener('change',()=>void read());date.addEventListener('change',()=>void read());
  return {async refresh(user){if(!['admin','superadmin'].includes(user.role)){this.clear();return;}panel.hidden=false;const changed=actor?.account!==user.account;actor=user;
    if(changed){campus.innerHTML=user.authorizedCampuses.map(value=>`<option>${escapeHtml(value)}</option>`).join('');selection='';}
    if(!saving && (changed || !selection))await read();else if(location.value!==savedValue)message.textContent='地点有未保存修改。';
  },clear(){generation++;actor=null;saving=false;selection='';revision=0;location.value=savedValue='';message.textContent='';$('#location-affected').replaceChildren();$('#location-history').replaceChildren();form.querySelectorAll('button,input,select').forEach(control=>control.disabled=false);panel.hidden=true;}};
}
