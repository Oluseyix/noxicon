'use client';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
const topics=['Response','Speed','Reliability'];
const outcomes=[
 {label:'Completed',copy:'Included in latency and generation speed.'},
 {label:'Failed',copy:'Errors and timeouts remain part of the record.'},
 {label:'Not started',copy:'Unstarted requests remain in the planned-request success rate.'},
];
export default function TestPreview(){
 const [active,setActive]=useState(0),[pace,setPace]=useState(2),[delay,setDelay]=useState(2),[replay,setReplay]=useState(0),[outcome,setOutcome]=useState(0);
 const id=useId(),reduced=useReducedMotion();const tabs=useRef<(HTMLButtonElement|null)[]>([]);
 function navigate(event:KeyboardEvent<HTMLButtonElement>,index:number){let next=index;if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;event.preventDefault();setActive(next);tabs.current[next]?.focus();}
 return <div className="cp-study">
  <div className="cp-tabs" role="tablist" aria-label="Explore performance">{topics.map((topic,i)=><button key={topic} role="tab" id={`${id}-tab-${i}`} aria-controls={`${id}-panel`} aria-selected={active===i} tabIndex={active===i?0:-1} ref={el=>{tabs.current[i]=el;}} onKeyDown={e=>navigate(e,i)} onClick={()=>setActive(i)}><span className="cp-tab-index" aria-hidden="true">0{i+1}</span>{topic}{active===i&&<motion.span className="cp-active-line" layoutId={`${id}-line`} transition={{duration:reduced?0:.3}}/>}</button>)}</div>
  <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`} tabIndex={0} className="cp-panel">
   <div className="cp-demonstration" key={`${active}-${replay}`}>
    {active===0?<div className="cp-response">
      <div className="cp-response-endpoints"><span>Request</span><span>First response</span></div>
      <div className="cp-response-path" aria-hidden="true"><div className="cp-path-line"/><motion.span className="cp-packet" key={delay} initial={{left:0}} animate={{left:'calc(100% - 16px)'}} transition={{duration:reduced?0:delay*.7,ease:'easeInOut'}}/><motion.div className="cp-response-burst" key={`burst-${delay}`} initial={{opacity:reduced?1:0,scaleX:reduced?1:.2}} animate={{opacity:1,scaleX:1}} transition={{delay:reduced?0:delay*.7,duration:.45}}>{[40,72,52,88,60,96,44].map((h,i)=><i key={i} style={{height:h}}/>)}</motion.div></div>
      <p className="cp-caption">The time between asking and receiving.</p>
    </div>:active===1?<div className="cp-stream" key={pace}><p className="cp-words" aria-label="An answer arrives one piece at a time.">{'An answer arrives one piece at a time.'.split(' ').map((word,i)=><motion.span key={i} aria-hidden="true" initial={{opacity:reduced?1:.14,y:reduced?0:10}} animate={{opacity:1,y:0}} transition={{delay:reduced?0:i*.44/pace,duration:.3}}>{word}{' '}</motion.span>)}</p><p className="cp-caption">Generation speed is how quickly the output arrives.</p></div>:<div className="cp-outcomes" role="group" aria-label="Explore request outcomes">{outcomes.map((item,i)=><button key={item.label} aria-pressed={outcome===i} onClick={()=>setOutcome(i)}><span>{item.label}</span><span className={`cp-outcome-track cp-outcome-${i}`} aria-hidden="true">{Array.from({length:12},(_,n)=><motion.i key={n} initial={{scaleY:reduced?1:.1,opacity:reduced?1:.2}} animate={{scaleY:1,opacity:1}} transition={{delay:reduced?0:n*.045,duration:.3}}/>)}</span><span aria-hidden="true">{outcome===i?'−':'+'}</span></button>)}</div>}
   </div>
   <div className="cp-controls">{active===2?<p className="cp-outcome-detail" aria-live="polite">{outcomes[outcome].copy}</p>:<><label htmlFor={`${id}-range`}>{active===0?'Response delay':'Generation pace'}<output>{(active===0?['Brief','Moderate','Longer']:['Slow','Steady','Fast'])[(active===0?delay:pace)-1]}</output></label><div className="cp-adjust"><input id={`${id}-range`} type="range" min={1} max={3} step={1} value={active===0?delay:pace} onChange={e=>active===0?setDelay(Number(e.target.value)):setPace(Number(e.target.value))}/><button onClick={()=>setReplay(r=>r+1)}>Replay</button></div></>}</div>
  </div>
 </div>;
}
