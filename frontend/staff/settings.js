import { $,showToast } from '/shared/utils.js';
import { apiJson,clearSession } from '/shared/api.js';
export function initSettings() {
  let generation=0;
  async function refresh(){
    const current=++generation;
    try{
      const user=await apiJson('/api/auth/me');
      if(current!==generation)return;
      $('#profile-info').textContent=`${user.name} · ${user.account} · 所属 ${user.homeCampus} · 授权 ${user.authorizedCampuses.join(' / ')}`;
    }catch(error){showToast(error.message);}
  }
  function signedOut(){
    clearSession();window.dispatchEvent(new CustomEvent('auth-expired'));
  }
  $('#password-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('[type="submit"]');
    if($('#new-password').value!==$('#confirm-password').value){showToast('两次新密码不一致');return;}
    button.disabled=true;
    try{
      await apiJson('/api/auth/password',{method:'PATCH',json:{currentPassword:$('#current-password').value,newPassword:$('#new-password').value}});
      form.reset();signedOut();showToast('密码已修改，所有会话已撤销，请重新登录');
    }catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#revoke-sessions').addEventListener('click',async()=>{
    try{await apiJson('/api/auth/revoke',{method:'POST'});signedOut();showToast('所有会话已撤销');}
    catch(error){showToast(error.message);}
  });
  return {refresh,clear(){generation++;$('#password-form').reset();$('#profile-info').textContent='';}};
}
