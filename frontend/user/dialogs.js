import { reveal } from './motion.js';
const controllers=new Set();
export function closeAllDialogs(){for(const controller of controllers)if(!controller.element.hidden)controller.close();}
export function dialogController(element, { onClose = () => {} } = {}) {
  let previousFocus,previousOverflow;
  const controls=()=>[...element.querySelectorAll('button,a[href],input,select,textarea')].filter(item=>!item.disabled && !item.hidden);
  function close(){if(element.hidden)return;onClose();element.hidden=true;document.body.style.overflow=previousOverflow || '';previousFocus?.focus();}
  function open(){previousFocus=document.activeElement;previousOverflow=document.body.style.overflow;element.hidden=false;document.body.style.overflow='hidden';reveal(element.querySelector('.modal'),{distance:12});controls()[0]?.focus();}
  function keydown(event){
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}
  }
  element.addEventListener('keydown',keydown);
  const controller={element,open,close,dispose(){close();element.removeEventListener('keydown',keydown);controllers.delete(controller);}};controllers.add(controller);return controller;
}
