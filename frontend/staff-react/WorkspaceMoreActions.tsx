import React,{useContext,useEffect,useRef} from 'react';
import {ActivityContext} from './field/ui';

// A disclosure of ordinary buttons; no partial ARIA menu keyboard model.
export function WorkspaceMoreActions({children,label='更多操作'}:{children:React.ReactNode;label?:string}) {
  const ref=useRef<HTMLDetailsElement>(null),active=useContext(ActivityContext);
  useEffect(()=>{
    const close=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))ref.current?.removeAttribute('open');};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){event.preventDefault();ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{if(!active&&ref.current)ref.current.open=false;},[active]);
  return <details className="workspace-more-actions" ref={ref} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}}><summary>{label}</summary><div className="workspace-more-action-list" role="group" aria-label={label} onClickCapture={event=>{const button=(event.target as HTMLElement).closest('button');if(button&&!button.disabled&&ref.current){ref.current.open=false;ref.current.querySelector('summary')?.focus();}}}>{children}</div></details>;
}
