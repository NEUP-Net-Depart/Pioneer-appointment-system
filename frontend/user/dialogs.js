import { reveal } from './motion.js';
const controllers=new Set();
export function closeAllDialogs(){for(const controller of controllers)if(!controller.element.hidden)controller.close();}
export function dialogController(element) {
  let previousFocus,previousOverflow;
  const controls=()=>[...element.querySelectorAll('button,a[href],input,select,textarea')].filter(item=>!item.disabled && !item.hidden);
  function close(){element.hidden=true;document.body.style.overflow=previousOverflow || '';previousFocus?.focus();}
  function open(){previousFocus=document.activeElement;previousOverflow=document.body.style.overflow;element.hidden=false;document.body.style.overflow='hidden';reveal(element.querySelector('.modal'),{distance:12});controls()[0]?.focus();}
  element.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  const controller={element,open,close};controllers.add(controller);return controller;
}
