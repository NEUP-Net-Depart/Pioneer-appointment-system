import { $ } from '/shared/utils.js';
import { validSignature,drawSignature } from '/shared/signature.js';
import { dialogController } from './dialogs.js';
export function initSignature() {
  const modal=$('#signature-modal'),canvas=$('#signature-canvas'),confirmed=$('#confirmed-signature');
  const dialog=dialogController(modal);
  let strokes=[],signed=null,pointer=null;
  const draw=(target,value)=>drawSignature(target,value,target.clientWidth ? target.width/target.clientWidth : 1);
  const point=event=>{const box=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))];};
  function resize(){if(modal.hidden)return;const box=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio || 1,3);canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);draw(canvas,strokes);}
  function close(){pointer=null;dialog.close();}
  function open(){strokes=[];pointer=null;$('#signature-error').textContent='';dialog.open();resize();}
  canvas.addEventListener('pointerdown',event=>{if(pointer!==null || strokes.length>=100)return;event.preventDefault();pointer=event.pointerId;canvas.setPointerCapture(pointer);strokes.push([point(event)]);});
  canvas.addEventListener('pointermove',event=>{if(event.pointerId!==pointer)return;event.preventDefault();if(strokes.flat().length>=5000)return;strokes.at(-1).push(point(event));draw(canvas,strokes);});
  function finish(event){if(event.pointerId!==pointer)return;if(strokes.at(-1).length<2)strokes.pop();pointer=null;}
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  $('#clear-signature').addEventListener('click',()=>{strokes=[];pointer=null;draw(canvas,strokes);});
  $('#cancel-signature').addEventListener('click',close);
  $('#confirm-signature').addEventListener('click',()=>{
    if(!validSignature(strokes)){$('#signature-error').textContent='请完整手写本人姓名，不能留白或只点一下。';return;}
    signed=strokes.map(stroke=>stroke.map(point=>[...point]));confirmed.hidden=false;confirmed.width=660;confirmed.height=264;draw(confirmed,signed);
    $('#signature-status').textContent='已完成手写签名。';$('[data-error-for=signature]').textContent='';$('#open-signature').removeAttribute('aria-invalid');$('#open-signature').textContent='重新手写签名';close();
  });
  $('#open-signature').addEventListener('click',open);
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  return {open,value:()=>signed,reset(){signed=null;strokes=[];confirmed.hidden=true;$('#signature-status').textContent='尚未完成手写签名。';$('#open-signature').textContent='手写本人姓名';},dispose(){observer.disconnect();}};
}
