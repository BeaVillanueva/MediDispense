import {useEffect,useRef,useState} from 'react';
export const RECEIPT_IDLE_SECONDS=5;

/** UI-only inactivity timer. No transaction, payment, or session mutation. */
export function startReceiptIdleTimer(target:EventTarget,onTick:(seconds:number)=>void,onExpire:()=>void,onHold:()=>void){
  const deadline=Date.now()+RECEIPT_IDLE_SECONDS*1000;
  let stopped=false;
  const events=['pointerdown','keydown','wheel'];
  const cleanup=()=>{clearInterval(timer);events.forEach(e=>target.removeEventListener(e,hold,true));};
  const hold=()=>{if(stopped)return;stopped=true;cleanup();onHold();};
  const timer=setInterval(()=>{if(stopped)return;const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));onTick(left);if(left===0){stopped=true;cleanup();onExpire();}},100);
  events.forEach(e=>target.addEventListener(e,hold,true));onTick(RECEIPT_IDLE_SECONDS);
  return ()=>{stopped=true;cleanup();};
}

export function useKioskReceipt(eligible:boolean,transactionId?:string){
  const stop=useRef<()=>void>(()=>{});
  const [requestedFor,setRequestedFor]=useState<string|null>(null);
  const requested=!!transactionId&&requestedFor===transactionId;
  const [state,setState]=useState({id:transactionId,open:false,seconds:RECEIPT_IDLE_SECONDS,held:false,expired:false,finished:false});
  useEffect(()=>{
    if(!eligible||!requested){setState(s=>({...s,open:false,expired:false,finished:false}));return;}
    setState({id:transactionId,open:true,seconds:RECEIPT_IDLE_SECONDS,held:false,expired:false,finished:false});
    stop.current=startReceiptIdleTimer(window,seconds=>setState(s=>s.seconds===seconds?s:{...s,seconds}),()=>setState(s=>({...s,open:false,expired:true,finished:true})),()=>setState(s=>({...s,held:true})));
    return stop.current;
  },[eligible,transactionId,requested]);
  return {...state,requested,open:eligible&&requested&&state.id===transactionId&&state.open,expired:eligible&&requested&&state.id===transactionId&&state.expired,finished:eligible&&requested&&state.id===transactionId&&state.finished,close:()=>{stop.current();setState(s=>({...s,open:false,held:true,expired:false,finished:true}));},show:()=>{
    if(!eligible||!transactionId)return;
    if(!requested){setRequestedFor(transactionId);return;}
    stop.current();setState(s=>({...s,open:true,held:true,expired:false,finished:false}));
  }};
}
