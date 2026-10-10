import { $,$$,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import {roleLabels as roleNames} from '/shared/constants.js';
const statusNames={open:'待激活',revoked:'已撤销',activated:'已激活',pending:'待审核',approved:'已通过',rejected:'已拒绝'};
export function initEnrollment({onAccountsChanged=()=>{}}={}){
  let generation=0,requests=[];
  async function refresh(){
    const current=++generation;
    try{
      const [whitelist,applications]=await Promise.all([apiJson('/api/staff-whitelist'),apiJson('/api/activation-requests')]);
      if(current!==generation)return;
      requests=applications.items;
      $('#select-pending').checked=false;
      $('#whitelist-table').innerHTML=whitelist.items.map(item=>`<tr><td>${escapeHtml(item.studentId)}</td><td>${escapeHtml(item.expectedName || '核验时确认')}</td><td>${roleNames[item.expectedRole]}</td><td>${escapeHtml(item.authorizedCampuses.join(' / '))}</td><td>${statusNames[item.status]}</td><td>${item.status==='activated' ? '' : `<button class="record-btn" data-whitelist="${escapeHtml(item.studentId)}" data-next-status="${item.status==='open' ? 'revoked' : 'open'}">${item.status==='open' ? '撤销资格' : '恢复资格'}</button>`}</td></tr>`).join('');
      $('#applications-table').innerHTML=requests.map(item=>`<tr><td>${item.status==='pending' ? `<input type="checkbox" data-application="${item.id}" aria-label="选择 ${escapeHtml(item.studentId)}" />` : ''}</td><td>${escapeHtml(item.studentId)}<span class="person-code">${escapeHtml(item.name)}</span></td><td>${escapeHtml(item.contact)}</td><td>${escapeHtml(item.homeCampus)}<span class="person-code">${roleNames[item.expectedRole]} · 授权 ${escapeHtml(item.authorizedCampuses.join(' / '))}</span></td><td>${statusNames[item.status]}<span class="person-code">${escapeHtml(item.reviewNote)}</span></td></tr>`).join('');
      $('#applications-empty').hidden=requests.length>0;
      $$('[data-whitelist]').forEach(button=>button.addEventListener('click',async()=>{
        button.disabled=true;
        try{await apiJson(`/api/staff-whitelist/${encodeURIComponent(button.dataset.whitelist)}`,{method:'PATCH',json:{status:button.dataset.nextStatus}});await refresh();showToast('激活资格已更新');}
        catch(error){showToast(error.message);}
        finally{button.disabled=false;}
      }));
      $('#import-role').querySelector('option[value=admin]').disabled=sessionStorage.getItem('pioneerRole')!=='superadmin';
    }catch(error){showToast(error.message);}
  }
  $('#whitelist-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('[type=submit]');
    const file=$('#whitelist-file').files[0];
    if(file && file.size>200000){showToast('CSV 文件不能超过 200 KB');return;}
    button.disabled=true;
    try{
      const csv=file ? await file.text() : $('#whitelist-csv').value;
      const result=await apiJson('/api/staff-whitelist/import',{method:'POST',json:{csv,expectedRole:$('#import-role').value,authorizedCampuses:$$('[name=importCampus]:checked').map(input=>input.value)}});
      await refresh();showToast(`已导入 ${result.imported.length} 条，已有记录跳过 ${result.skipped.length} 条`);
    }catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#copy-activation-url').addEventListener('click',async()=>{
    const url=new URL('/staff/?activate=1',location.origin).href;
    try{await navigator.clipboard.writeText(url);showToast('统一激活网址已复制');}
    catch{$('#activation-url').textContent=url;showToast('请复制页面显示的激活网址');}
  });
  async function review(status){
    const ids=$$('[data-application]:checked').map(input=>input.dataset.application);
    if(!ids.length){showToast('请先选择待审申请');return;}
    const buttons=[$('#approve-applications'),$('#reject-applications')];buttons.forEach(button=>button.disabled=true);
    try{
      const result=await apiJson('/api/activation-requests/review',{method:'POST',json:{ids,status,identityVerified:$('#verify-identities').checked,reviewNote:$('#review-note').value.trim()}});
      $('#verify-identities').checked=false;$('#review-note').value='';await refresh();await onAccountsChanged();
      showToast(`已处理 ${result.applied.length} 条${result.conflicts.length ? '，部分申请已更新，请刷新核实' : ''}`);
    }catch(error){showToast(error.message);}
    finally{buttons.forEach(button=>button.disabled=false);}
  }
  $('#select-pending').addEventListener('change',()=>$$('[data-application]').forEach(input=>input.checked=$('#select-pending').checked));
  $('#approve-applications').addEventListener('click',()=>review('approved'));
  $('#reject-applications').addEventListener('click',()=>review('rejected'));
  return {refresh,clear(){generation++;requests=[];$('#whitelist-form').reset();$('#select-pending').checked=false;$('#applications-table').innerHTML='';$('#whitelist-table').innerHTML='';$('#verify-identities').checked=false;$('#review-note').value='';}};
}
