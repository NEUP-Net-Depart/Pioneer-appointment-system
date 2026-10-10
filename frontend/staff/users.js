import {$,$$,showToast,escapeHtml} from '/shared/utils.js';
import {apiJson} from '/shared/api.js';
import {roleLevel,roleLabels,CAMPUSES} from '/shared/constants.js';
import {initEnrollment} from './enrollment.js';
export function initUsers(){
  const enrollment=initEnrollment({onAccountsChanged:()=>syncUsers()});let users=[],generation=0,editing;
  const currentRole=()=>sessionStorage.getItem('pioneerRole') || '';
  const canManage=user=>!user.protected && roleLevel[currentRole()]>roleLevel[user.role];
  async function syncUsers(){
    const current=++generation;
    try{const result=await apiJson('/api/users');if(current!==generation)return;users=result.items;render();}
    catch(error){if(current===generation)showToast(error.message);}
  }
  function editUser(user){
    editing=user;
    $('#edit-user-title').textContent=`编辑 ${user.account}`;
    $('#edit-user-name').value=user.name;
    $('#edit-user-role').innerHTML=Object.entries(roleLabels).filter(([role])=>roleLevel[role]<roleLevel[currentRole()]).map(([role,label])=>`<option value="${role}">${label}</option>`).join('');
    $('#edit-user-role').value=user.role;$('#edit-home-campus').value=user.homeCampus;
    const allowed=JSON.parse(sessionStorage.getItem('pioneerCampuses') || '[]');
    $('#edit-campus-grants').innerHTML=CAMPUSES.map(campus=>`<label class="checkbox-label"><input type="checkbox" name="editCampus" value="${campus}" ${user.authorizedCampuses.includes(campus) ? 'checked' : ''} ${allowed.includes(campus) ? '' : 'disabled'} /> ${campus}</label>`).join('');
    $('#edit-user-password').value='';$('#user-edit-modal').hidden=false;$('#edit-user-name').focus();
  }
  function render(){
    const query=$('#user-search').value.trim().toLowerCase();
    const rows=users.filter(user=>!query || [user.account,user.name,user.homeCampus,...user.authorizedCampuses,roleLabels[user.role]].some(value=>value.toLowerCase().includes(query)));
    $('#users-table').innerHTML=rows.map(user=>`<tr><td><span class="person-name">${escapeHtml(user.account)}</span><span class="person-code">创建于 ${escapeHtml(user.createdAt)}</span></td><td>${escapeHtml(user.name)}</td><td>${roleLabels[user.role]}</td><td>所属 ${escapeHtml(user.homeCampus)}<span class="person-code">授权 ${escapeHtml(user.authorizedCampuses.join(' / '))}</span></td><td><span class="user-status ${user.status==='enabled' ? 'is-active' : 'is-disabled'}">${user.status==='enabled' ? '启用' : '已停用'}</span></td><td>${user.workload} 条记录</td><td>${user.protected ? '系统保护 · 本人可在个人设置改密' : canManage(user) ? `<button class="record-btn" data-edit-user="${user.account}">编辑权限</button><button class="record-btn" data-toggle-user="${user.account}">${user.status==='enabled' ? '停用' : '恢复'}</button><button class="record-btn" data-reset-user="${user.account}">重置密码</button>` : '本人账号 · 个人设置'}</td></tr>`).join('');
    $('#users-empty').hidden=rows.length>0;
    $$('[data-edit-user]').forEach(button=>button.addEventListener('click',()=>editUser(users.find(user=>user.account===button.dataset.editUser))));
    $$('[data-toggle-user]').forEach(button=>button.addEventListener('click',async()=>{
      const user=users.find(item=>item.account===button.dataset.toggleUser);button.disabled=true;
      try{await apiJson(`/api/users/${encodeURIComponent(user.account)}`,{method:'PATCH',json:{status:user.status==='enabled' ? 'disabled' : 'enabled'}});await syncUsers();showToast('账号状态已更新，旧会话已撤销');}
      catch(error){showToast(error.message);}
      finally{button.disabled=false;}
    }));
    $$('[data-reset-user]').forEach(button=>button.addEventListener('click',()=>{editUser(users.find(user=>user.account===button.dataset.resetUser));$('#edit-user-password').focus();}));
  }
  function close(){editing=undefined;$('#edit-user-password').value='';$('#user-edit-modal').hidden=true;}
  $('#user-edit-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!editing)return;
    const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;
    try{
      const password=$('#edit-user-password').value;
      await apiJson(`/api/users/${encodeURIComponent(editing.account)}`,{method:'PATCH',json:{name:$('#edit-user-name').value.trim(),role:$('#edit-user-role').value,homeCampus:$('#edit-home-campus').value,authorizedCampuses:$$('[name=editCampus]:checked').map(input=>input.value),...(password ? {password} : {})}});
      close();await syncUsers();showToast('账号与校区授权已更新，旧会话已撤销');
    }catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#close-user-edit').addEventListener('click',close);$('#cancel-user-edit').addEventListener('click',close);
  $('#user-edit-modal').addEventListener('click',event=>{if(event.target.id==='user-edit-modal')close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  $('#user-search').addEventListener('input',render);render();
  return{refresh:()=>Promise.all([syncUsers(),enrollment.refresh()]),clear(){generation++;enrollment.clear();users=[];close();render();}};
}
