const running=new WeakMap();
const easing='cubic-bezier(.2,.75,.25,1)';
const items='.step-heading,.selection-summary,.form-block > h3,.form-block > .field,.review-group,.booking-preparation,.agreement-check,.step-actions,.booking-date-panel,.booking-time-panel,#booking-location,.booking-feedback';
const visible=element=>element.getClientRects().length>0;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate(element,frames,{duration=280,delay=0}={}) {
  running.get(element)?.cancel();
  if(reduced() || !visible(element))return;
  const animation=element.animate(frames,{duration,delay,easing,fill:'backwards'});
  running.set(element,animation);
  animation.finished.then(()=>{if(running.get(element)===animation)running.delete(element);},()=>{});
}
export function reveal(element,{delay=0,distance=8}={}) {
  animate(element,[{opacity:0,transform:`translateY(${distance}px)`},{opacity:1,transform:'translateY(0)'}],{delay});
}

// Measure before hiding anything, then move surviving fields from their current
// positions. Hidden controls leave validation and the tab order immediately.
export function animateLayout(root,change,{stagger=false,resize=false}={}) {
  const elements=[...root.querySelectorAll(items)];
  const before=new Map(reduced() ? [] : elements.filter(visible).map(element=>[element,element.getBoundingClientRect()]));
  const height=resize && visible(root) ? root.getBoundingClientRect().height : 0;
  change();
  if(resize){
    running.get(root)?.cancel();
    const next=visible(root) ? root.getBoundingClientRect().height : 0;
    if(height && next && Math.abs(height-next)>.5)animate(root,[{height:`${height}px`},{height:`${next}px`}]);
  }
  let index=0;
  for(const element of new Set([...elements,...root.querySelectorAll(items)])){
    const previous=before.get(element);
    running.get(element)?.cancel();
    if(reduced() || !visible(element))continue;
    const next=element.getBoundingClientRect();
    if(!previous){reveal(element,{delay:stagger ? Math.min(index++*24,144) : 0});continue;}
    const x=previous.left-next.left,y=previous.top-next.top;
    if(Math.abs(x)+Math.abs(y)>.5)animate(element,[{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}]);
  }
}

export function setVisible(element,show) {
  if(element.hidden===!show)return;
  element.hidden=!show;
  if(show)reveal(element);
}
export function setMessage(element,message) {
  if(element.textContent===message && element.hidden===!message)return;
  element.textContent=message;element.hidden=!message;
  if(message)reveal(element,{distance:4});
}
