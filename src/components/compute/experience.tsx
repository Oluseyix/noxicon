'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import HardwareVisual from './hardware-visual';
import type { HardwareMotion } from './gpu-scene';
import TestPreview from './test-preview';

const stages=['Request sent','Model processing','First response','Output complete'];
const evidence=[
 {title:'Benchmark measurements',short:'Measure',kind:'Observed by the runner',copy:'Timing, token usage and request outcomes. A precise record of what your test observed.',limit:'Performance measurements do not prove where a model executed.',artifact:'Request timings',lines:['Time to first token','Output throughput','Success & failure']},
 {title:'Execution evidence',short:'Verify',kind:'Valid provider evidence required',copy:'Attestation and response verification can support specific claims about execution.',limit:'A gateway signature alone does not prove GPU TEE execution. No verified execution is shown here.',artifact:'Execution evidence',lines:['Deployment attestation','Response signature','Provider TEE ≠ gateway']},
 {title:'Local report fingerprints',short:'Commit',kind:'A fingerprint of the report',copy:'A canonical report can be hashed, exported and compared without changing its contents.',limit:'Local report fingerprints differ from the NEAR publication commitment and do not independently validate measurements.',artifact:'report.json',lines:['Configuration','Results','SHA-256 fingerprint']},
 {title:'NEAR Testnet publication',short:'Publish',kind:'Publication status not checked here.',copy:'Export a report, preview its publication commitment, then use the explicitly authorized operator workflow.',limit:'Benchmark completion does not publish automatically. Verify a published report with its matching receipt. Judges can run npm run verify:demo for the separate historical demonstration.',artifact:'NEAR Testnet',lines:['Publication commitment','Matching receipt','Independent verification']},
];
export default function ComputeExperience(){
 const root=useRef<HTMLDivElement>(null);const hardware=useRef<HardwareMotion>({progress:0});
 const [stage,setStage]=useState(0),[selected,setSelected]=useState(0);
 useEffect(()=>{
  let disposed=false;let cleanup:(()=>void)|undefined;
  Promise.all([import('gsap'),import('gsap/ScrollTrigger')]).then(([{gsap},{ScrollTrigger}])=>{
   if(disposed||!root.current)return;gsap.registerPlugin(ScrollTrigger);
   const media=gsap.matchMedia();
   media.add({motion:'(prefers-reduced-motion: no-preference)',desktop:'(min-width: 901px)'},context=>{
    const {motion:allowed,desktop}=context.conditions!;
    const el=root.current!;const track=el.querySelector('.cy-inference')!;
    if(!allowed){setStage(3);gsap.set('.cy-output-word',{opacity:1,y:0});return;}
    ScrollTrigger.create({trigger:el.querySelector('.cy-hero'),start:'top top',end:'bottom top',onUpdate:self=>{hardware.current.progress=self.progress;hardware.current.invalidate?.();}});
    const timeline=gsap.timeline({scrollTrigger:{trigger:track,start:desktop?'top top':'top 65%',end:desktop?'bottom bottom':'bottom 65%',scrub:true,onUpdate:self=>{const next=Math.min(3,Math.floor(self.progress*4));setStage(old=>old===next?old:next);}},defaults:{ease:'none'}});
    timeline.fromTo('.cy-request-packet',{left:'12%',opacity:0},{left:'43%',opacity:1,duration:1},0)
      .fromTo('.cy-core-cell',{opacity:.15},{opacity:1,stagger:{each:.025,from:'center'},duration:.3},.6)
      .fromTo('.cy-output-packet',{left:'57%',opacity:0},{left:'75%',opacity:1,duration:.8},1.6)
      .fromTo('.cy-output-word',{opacity:.12,y:8},{opacity:1,y:0,stagger:.12,duration:.2},2.05)
      .fromTo('.cy-inference-progress',{scaleX:0},{scaleX:1,duration:3.3},0);
    gsap.fromTo('.cy-launch-lines path',{strokeDashoffset:700},{strokeDashoffset:0,stagger:.07,ease:'none',scrollTrigger:{trigger:'.cy-launch',start:'top 85%',end:'center 60%',scrub:true}});
   },root);
   cleanup=()=>media.revert();
  }).catch(()=>{/* The complete, readable scene remains available if motion cannot load. */});
  return()=>{disposed=true;cleanup?.();};
 },[]);
 return <MotionConfig reducedMotion="user"><div className="cy-page" ref={root}>
  <a className="cy-skip" href="#main">Skip to content</a>
  <header className="cy-nav"><div className="cy-frame"><Link href="/" className="cy-brand" aria-label="Noxicon home">noxicon.</Link><nav aria-label="Main navigation"><a href="#technology">Technology</a><Link href="/app" className="cy-button">Launch App</Link></nav></div></header>
  <main id="main" tabIndex={-1}>
   <section className="cy-hero" aria-labelledby="hero-title"><div className="cy-frame cy-hero-grid">
    <div className="cy-hero-copy"><p className="cy-eyebrow">Measure compute. Verify evidence.</p><h1 id="hero-title"><span>Compute</span>{' '}<span>deserves</span>{' '}<span className="cy-silver">proof.</span></h1><p className="cy-intro">Benchmark AI inference. Verify published report commitments.<br/>Make every result accountable.</p><div className="cy-actions"><Link href="/app" className="cy-button">Launch App</Link><a href="#technology" className="cy-text-link">Explore Technology</a></div></div>
    <HardwareVisual motion={hardware}/>
    <div className="cy-hero-base"><span>Beyond the specification.</span><a href="#technology">Inside the computation <span aria-hidden="true">↓</span></a></div>
   </div></section>
   <section id="technology" className="cy-inference" aria-labelledby="inference-title"><div className="cy-inference-sticky"><div className="cy-frame">
    <div className="cy-scene-heading"><div><p className="cy-eyebrow">02 / Inside inference</p><h2 id="inference-title">A request goes in.<br/><span className="cy-muted">Intelligence comes out.</span></h2></div><p>Between the two,<br/>every moment matters.</p></div>
    <div className="cy-pipeline" data-stage={stage} aria-label="Conceptual inference sequence">
     <div className="cy-request"><span className="cy-caption">Input</span><div className="cy-prompt-mark" aria-hidden="true"><span/><span/><span/></div><strong>Your request</strong></div>
     <svg className="cy-inference-wires" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><path d="M160 150H320L370 100H435M160 165H310L360 215H435M565 100H630L680 150H765M565 215H640L690 165H765"/><path className="cy-wire-center" d="M160 150H435M565 150H765"/></svg>
     <span className="cy-request-packet" aria-hidden="true"/><span className="cy-output-packet" aria-hidden="true"/>
     <div className="cy-core" aria-hidden="true"><div className="cy-core-pins"/><div className="cy-core-face"><div className="cy-core-matrix">{Array.from({length:36},(_,i)=><i key={i} className="cy-core-cell"/>)}</div><span>Inference</span></div></div>
     <div className="cy-output"><span className="cy-caption">Output</span><p>{['An','answer.','One','piece','at','a','time.'].map((word,i)=><span className="cy-output-word" key={i}>{word}{' '}</span>)}</p></div>
    </div>
    <ol className="cy-stages" aria-label="Request lifecycle">{stages.map((text,i)=><li key={text} data-active={stage>=i}><span>0{i+1}</span>{text}</li>)}</ol><div className="cy-inference-progress" aria-hidden="true"/>
    <div className="cy-inference-foot"><span>Request lifecycle</span><p>Latency is the wait. Throughput is the flow.</p></div>
   </div></div></section>
   <section id="performance" className="cy-performance" aria-labelledby="performance-title"><div className="cy-frame">
    <div className="cy-scene-heading"><div><p className="cy-eyebrow">03 / Explore performance</p><h2 id="performance-title">Speed is only<br/><span className="cy-muted">the beginning.</span></h2></div><p>Three ways to understand what your AI delivers.</p></div>
    <div className="cy-performance-body"><div className="cy-study-note"><span className="cy-caption">Interactive concepts</span><p>Feel the difference.</p><span>Explore the behavior.<br/>Measure your model in the app.</span></div><TestPreview/></div>
   </div></section>
   <section id="evidence" className="cy-evidence" aria-labelledby="evidence-title"><div className="cy-frame">
    <div className="cy-scene-heading"><div><p className="cy-eyebrow">04 / The evidence path</p><h2 id="evidence-title">Trust what<br/><span className="cy-muted">you can verify.</span></h2></div><p>Observation. Verification. Commitment.<br/>Different evidence. Different claims.</p></div>
    <div className="cy-evidence-steps" role="group" aria-label="Evidence layers">{evidence.map((item,i)=><button key={item.title} aria-label={item.title} aria-pressed={selected===i} onClick={()=>setSelected(i)}><span>0{i+1}</span><strong>{item.short}</strong><i aria-hidden="true"/></button>)}</div>
    <div className="cy-evidence-detail"><div className="cy-artifact" aria-hidden="true"><div className="cy-artifact-stack"/><div className="cy-artifact-sheet"><span>NOXICON / EVIDENCE</span><strong>{evidence[selected].artifact}</strong><div>{evidence[selected].lines.map((line,i)=><motion.p key={`${selected}-${i}`} initial={{opacity:.3,x:-8}} animate={{opacity:1,x:0}} transition={{duration:.3,delay:i*.08}}><span>0{i+1}</span>{line}</motion.p>)}</div><span className="cy-artifact-footer">Inspect · Export · Compare</span></div></div>
    <motion.div key={selected} className="cy-evidence-copy" initial={{opacity:.4,y:8}} animate={{opacity:1,y:0}} transition={{duration:.25}}><span className="cy-caption">{evidence[selected].kind}</span><h3>{evidence[selected].title}</h3><p>{evidence[selected].copy}</p><p className="cy-evidence-limit">{evidence[selected].limit}</p><Link href="/app" className="cy-text-link">Inspect a report</Link></motion.div></div>
   </div></section>
   <section className="cy-launch" aria-labelledby="launch-title"><svg className="cy-launch-lines" viewBox="0 0 1440 600" preserveAspectRatio="none" aria-hidden="true">{[0,1,2,3,4].map(i=><path key={i} d={`M${i*45} 0 V${110+i*26} L${340+i*38} 450 V600 M${1440-i*45} 0 V${110+i*26} L${1100-i*38} 450 V600`}/>)}</svg><div className="cy-frame"><p className="cy-eyebrow">Less assumption. More understanding.</p><h2 id="launch-title">Know what your AI<br/>{' '}is actually delivering.</h2><Link href="/app" className="cy-button">Launch App</Link><p className="cy-launch-signoff">Measure compute. Verify evidence.</p></div></section>
  </main>
  <footer className="cy-footer"><div className="cy-frame"><Link href="/" className="cy-brand" aria-label="Noxicon home">noxicon.</Link><span>Compute deserves proof.</span><a href="#hero-title">Back to top</a></div></footer>
 </div></MotionConfig>;
}
