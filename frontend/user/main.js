import { trackPage } from '/shared/telemetry-client.js';
import { $,$$ } from '/shared/utils.js';
import { initBooking } from './booking.js';
import { initLookup } from './lookup.js';
import { closeAllDialogs } from './dialogs.js';
import { initInputLimits } from '/shared/input-limits.js';
initInputLimits($('#import-form'));
let booking,lookup,lastHandled;
function activate(view,telemetryView=view){if(telemetryView)trackPage('student.'+telemetryView);closeAllDialogs();$('#student-loading').hidden=true;$$('.view').forEach(element=>element.classList.toggle('is-active',element.dataset.view===view));$$('[data-view-link]').forEach(element=>{const selected=element.dataset.viewLink===view;element.classList.toggle('is-active',selected);if(selected)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current');});booking?.setActive(view==='booking');lookup?.setActive(view==='lookup');window.scrollTo({top:0,behavior:'auto'});}
function navigate(kind,id,{record=true}={}){const fragment=kind==='detail' ? '#detail='+encodeURIComponent(id) : '#'+kind;if(record && location.hash!==fragment)history.pushState(null,'',fragment);lastHandled=location.hash;activate(kind==='booking' ? 'booking' : 'lookup',kind);}
lookup=initLookup({onNavigate:navigate,onRebook:()=>{if(booking.reset())navigate('booking');},hasDraft:()=>booking?.hasDraft(),hasPending:()=>booking?.hasPending()});
booking=initBooking({onCreated:item=>lookup.add(item),onViewCreated:item=>{navigate('detail',item.id);void lookup.showDetail(item.id);}});
$$('[data-view-link]').forEach(button=>button.addEventListener('click',()=>{const view=button.dataset.viewLink;navigate(view);if(view==='lookup')void lookup.showList();}));
async function route(){const fragment=location.hash;if(fragment===lastHandled)return;lastHandled=fragment;
  if(fragment.includes('appointment=') || fragment.includes('access=')){
    const link=location.href;history.replaceState(null,'',location.pathname+'#lookup');lastHandled=location.hash;activate('lookup',null);
    $('#lookup-list').hidden=true;$('#lookup-detail').hidden=true;$('#student-loading').hidden=false;
    try{await lookup.importLink(link);}catch(error){if(location.hash!=='#lookup')return;trackPage('student.lookup');void lookup.showList();lookup.openImport();$('#private-link-input').value=link;$('#import-error').textContent=error.message || '私人链接暂时无法读取，请重试。';}finally{$('#student-loading').hidden=true;}return;
  }
  if(fragment.startsWith('#detail=')){let id;try{id=decodeURIComponent(fragment.slice(8));}catch{navigate('lookup');await lookup.showList();lookup.openImport();$('#import-error').textContent='预约链接格式不正确，请使用完整私人查询链接。';return;}navigate('detail',id,{record:false});await lookup.showDetail(id);}
  else if(fragment==='#lookup'){navigate('lookup',null,{record:false});await lookup.showList();}
  else navigate('booking',null,{record:false});
}
window.addEventListener('popstate',()=>void route());window.addEventListener('hashchange',()=>void route());void route();
