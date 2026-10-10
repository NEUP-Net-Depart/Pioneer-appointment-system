import { $,showToast } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
const KEY='pioneerActivationReceipt';
export function initActivation(){
  if(new URLSearchParams(location.search).get('activate')!=='1')return false;
  $('#login-view').hidden=true;$('#activation-view').hidden=false;
  let receipt;
  try{receipt=JSON.parse(localStorage.getItem(KEY) || 'null');}catch{receipt=null;}
  const labels={pending:'申请已提交，等待管理员核验身份',approved:'审核已通过，可以使用学号和自行设置的密码登录',rejected:'申请未通过，可核实资料后重新申请'};
  function render(item){
    $('#activation-result').hidden=false;
    $('#activation-status').textContent=labels[item.status];
    $('#activation-note').textContent=item.reviewNote || '审核通过前不能登录工作人员系统。';
    $('#activation-form').hidden=item.status!=='rejected';
    $('#activation-login').hidden=item.status!=='approved';
  }
  async function refresh(){
    if(!receipt){showToast('此浏览器暂无申请回执');return;}
    try{render(await apiJson(`/api/activation/${encodeURIComponent(receipt.id)}`,{headers:{'X-Activation-Receipt':receipt.receipt}}));}
    catch(error){showToast(error.message);}
  }
  $('#activation-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if($('#activation-password').value!==$('#activation-confirm').value){showToast('两次密码不一致');return;}
    const form=event.currentTarget,button=form.querySelector('[type=submit]');
    button.disabled=true;
    try{
      const item=await apiJson('/api/activation',{method:'POST',json:{studentId:$('#activation-student-id').value.trim(),name:$('#activation-name').value.trim(),homeCampus:$('#activation-campus').value,contact:$('#activation-contact').value.trim(),password:$('#activation-password').value}});
      receipt={id:item.id,receipt:item.receipt};
      try{localStorage.setItem(KEY,JSON.stringify(receipt));}catch{showToast('申请已提交，浏览器无法保存回执，请联系管理员了解审核进度');}
      form.reset();render(item);
    }catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#refresh-activation').addEventListener('click',refresh);
  if(receipt)refresh();
  return true;
}
