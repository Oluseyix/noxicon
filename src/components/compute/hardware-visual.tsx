'use client';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { HardwareMotion } from './gpu-scene';

const GPUScene=dynamic(()=>import('./gpu-scene'),{ssr:false});
class GraphicsBoundary extends Component<{children:ReactNode;onFailure:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onFailure();}
  render(){return this.state.failed?null:this.props.children;}
}
export default function HardwareVisual({motion}:{motion:RefObject<HardwareMotion>}){
  const host=useRef<HTMLDivElement>(null);
  const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[visible,setVisible]=useState(false),[failed,setFailed]=useState(false),[photo,setPhoto]=useState(false);
  useEffect(()=>{
    const el=host.current!;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const connection=(navigator as Navigator & {connection?:{saveData?:boolean}}).connection;
    const eligible=()=>!reduced.matches&&!connection?.saveData;
    let checked=false;
    const observer=new IntersectionObserver(([entry])=>{
      setVisible(entry.isIntersecting&&!document.hidden);
      if(!entry.isIntersecting||checked)return;
      checked=true;
      if(!eligible()){setPhoto(true);return;}
      try{const canvas=document.createElement('canvas');const gl=canvas.getContext('webgl2',{failIfMajorPerformanceCaveat:true});if(gl){gl.getExtension('WEBGL_lose_context')?.loseContext();setEnabled(true);}else setPhoto(true);}catch{setPhoto(true);}
    },{threshold:.01});observer.observe(el);
    const visibility=()=>setVisible(!document.hidden&&el.getBoundingClientRect().bottom>0&&el.getBoundingClientRect().top<innerHeight);
    const preference=()=>{setEnabled(false);setReady(false);setPhoto(!eligible());checked=false;observer.unobserve(el);observer.observe(el);};
    const lost=()=>{setFailed(true);setReady(false);setPhoto(true);};
    document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',preference);el.addEventListener('veyra-context-lost',lost);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',preference);el.removeEventListener('veyra-context-lost',lost);};
  },[]);
  const rendered=useCallback(()=>setReady(true),[]);
  const failure=useCallback(()=>{setFailed(true);setReady(false);setPhoto(true);},[]);
  return <div className="cy-hardware" ref={host} data-renderer={ready&&!failed?'webgl':'image'} role="img" aria-label="Three-dimensional dual-fan AI accelerator, with a machined metal chassis and layered cooling fins">
    <Image className="cy-hardware-fallback" src="/images/accelerator.webp" width={1536} height={1024} alt="" sizes="(max-width: 900px) 94vw, 58vw" style={{opacity:photo?1:0}}/>
    {enabled&&!failed&&<div className="cy-canvas" aria-hidden="true"><GraphicsBoundary onFailure={failure}><GPUScene motion={motion} visible={visible} onReady={rendered}/></GraphicsBoundary></div>}
    <div className="cy-hardware-index" aria-hidden="true"><span>01 / Compute</span><span>Architecture in motion</span></div>
  </div>;
}
