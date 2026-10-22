import { $, escapeHtml } from '/shared/utils.js';
import { dialogController } from './dialogs.js';

// Acceptance is scoped to the campus and exact published version, never a title.
export function initBookingNotices() {
  const root=$('#booking-notices'),layer=$('#booking-notice-modal'),body=$('#booking-notice-body');
  const dialog=dialogController(layer),accepted=new Set(),shown=new Set();
  let campus='',items=[],fingerprint='',home=true,active=true;
  const key=item=>`${campus}/${item.id}/${item.revision}`;
  const missing=()=>items.find(item=>item.important && !accepted.has(key(item)));
  const visible=()=>home && active && !document.hidden;
  const readButton=item=>`<button type="button" class="secondary-btn booking-notice-read" data-read-notice="${escapeHtml(item.id)}">我已阅读并确认此公告</button>`;
  function article(item) {
    return `<article class="booking-notice${item.important ? ' is-important' : ''}" data-announcement="${escapeHtml(item.id)}"><h3>${item.important ? '必读 · ' : ''}${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p>${item.important ? readButton(item) : ''}</article>`;
  }
  function syncButtons() {
    for(const parent of [root,body])for(const button of parent.querySelectorAll('[data-read-notice]')){
      const item=items.find(item=>item.id===button.dataset.readNotice),read=!!item && accepted.has(key(item));
      button.textContent=read ? '已阅读并确认' : '我已阅读并确认此公告';
      button.setAttribute('aria-pressed',String(read));
    }
    for(const preview of root.querySelectorAll('[data-open-notices]')){
      const item=items.find(item=>item.id===preview.dataset.openNotices);
      if(item?.important)preview.previousElementSibling.querySelector('span').textContent=accepted.has(key(item)) ? '已阅读并确认' : '阅读确认后可继续预约';
    }
    if(!missing())$('#booking-notice-error').hidden=true;
  }
  function close(){if(!layer.hidden)dialog.close();}
  function open(item) {
    if(!visible())return;
    for(const notice of items.filter(item=>item.displayMode==='modal'))shown.add(key(notice));
    if(layer.hidden)dialog.open();
    if(item)body.querySelectorAll('[data-read-notice]').forEach(button=>{
      if(button.dataset.readNotice===item.id){button.focus({preventScroll:true});button.scrollIntoView({block:'center',behavior:'auto'});}
    });
  }
  function autoOpen(){if(visible() && items.some(item=>item.displayMode==='modal' && !shown.has(key(item))))open();}
  function read(event) {
    const button=event.target.closest('[data-read-notice]');
    if(!button)return;
    const item=items.find(item=>item.id===button.dataset.readNotice);
    if(item){accepted.add(key(item));syncButtons();}
  }
  root.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-open-notices]');
    if(trigger)open(items.find(item=>item.id===trigger.dataset.openNotices));else read(event);
  });
  body.addEventListener('click',read);
  $('#close-booking-notices').addEventListener('click',close);
  const visibility=()=>{if(document.hidden)close();else autoOpen();};
  document.addEventListener('visibilitychange',visibility);
  return {
    render(notices,nextCampus) {
      const nextItems=notices.filter(item=>item.type!=='suspension'),nextFingerprint=JSON.stringify([nextCampus,nextItems]);
      if(fingerprint!==nextFingerprint){
        close();campus=nextCampus;items=nextItems;fingerprint=nextFingerprint;
        root.innerHTML=items.map(item=>item.displayMode==='modal'
          ? `<article class="booking-notice booking-notice-preview"><div><h3>${item.important ? '必读 · ' : ''}${escapeHtml(item.title)}</h3><span>${item.important ? '阅读确认后可继续预约' : '校区公告'}</span></div><button type="button" class="secondary-btn" data-open-notices="${escapeHtml(item.id)}">查看公告</button></article>`
          : article(item)).join('');
        root.insertAdjacentHTML('afterbegin','<p id="booking-notice-error" class="field-error" role="alert" hidden>请先点击阅读按钮，确认已阅读必读公告后再继续。</p>');
        body.innerHTML=items.filter(item=>item.displayMode==='modal').map(article).join('');
        syncButtons();
      }
      root.hidden=!items.length;autoOpen();
    },
    hasUnaccepted:()=>!!missing(),
    confirm() {
      const item=missing();if(!item)return true;
      if(!visible())return false;
      $('#booking-notice-error').hidden=false;
      if(item.displayMode==='modal')open(item);
      else for(const button of root.querySelectorAll('[data-read-notice]'))if(button.dataset.readNotice===item.id){
        button.focus({preventScroll:true});button.scrollIntoView({block:'center',behavior:'auto'});
      }
      return false;
    },
    accepted:()=>items.filter(item=>item.important && accepted.has(key(item))).map(({id,revision})=>({id,revision})),
    setHome(value){home=value;if(!value)close();else autoOpen();},
    setActive(value){active=value;if(!value)close();else autoOpen();},
    reset(){close();accepted.clear();shown.clear();fingerprint='';},
    dispose(){close();document.removeEventListener('visibilitychange',visibility);}
  };
}
