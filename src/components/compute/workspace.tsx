'use client';
import { useEffect, useRef, useState } from 'react';
import RunProgress, { type RequestProgress } from './run-progress';
import { readLiveEvents } from '../../lib/compute/live-events';
import { configSchema, workload, type BenchmarkConfig } from '../../lib/compute/config';
import { cloudProviderSchema, providerNames } from '../../lib/compute/providers';
import { inspectReport, type InspectedReport } from '../../lib/compute/report-browser';
import ReportView from './report-view';
import Evidence from './evidence';
import ReceiptVerification from './receipt-verification';
import { recommendedOutputTokens } from '../../lib/compute/model-defaults';
export default function Workspace(){
 const [inspected,setInspected]=useState<InspectedReport|null>(null),[example,setExample]=useState(false),[results,setResults]=useState(false);
 const [mode,setMode]=useState('quick'),[measured,setMeasured]=useState(3),[warmup,setWarmup]=useState(1),[tokens,setTokens]=useState(96),[concurrency,setConcurrency]=useState(1),[timeout,setTimeout]=useState(30);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [models,setModels]=useState<{id:string;name:string;maxOutputTokens:number}[]>([]),[model,setModel]=useState(''),[catalogBusy,setCatalogBusy]=useState(true),[availability,setAvailability]=useState('Checking available models…');
 const [running,setRunning]=useState(false),[preparing,setPreparing]=useState(true),[rows,setRows]=useState<Record<number,RequestProgress>>({}),[live,setLive]=useState(false);
 const [reviewSettings,setReviewSettings]=useState(false);
 const [providerName,setProviderName]=useState('Cloud inference');
 const catalogAbort=useRef<AbortController|null>(null);
 async function refreshModels(){
  catalogAbort.current?.abort();const controller=new AbortController();catalogAbort.current=controller;setCatalogBusy(true);setProviderName('Cloud inference');
  try{const response=await fetch('/api/benchmarks/models',{signal:controller.signal});const data=await response.json().catch(()=>null);if(!response.ok||!Array.isArray(data?.models))throw new Error(data?.message||'Live testing is unavailable right now. Explore a sample report or retry.');if(controller.signal.aborted)return;const provider=cloudProviderSchema.safeParse(data.provider);setProviderName(provider.success?providerNames[provider.data]:'Cloud inference');setModels(data.models);setModel(data.models[0]?.id||'');if(data.models[0])setTokens(recommendedOutputTokens(data.models[0]));setAvailability(data.message);}
  catch(e){if(!controller.signal.aborted){setModels([]);setModel('');setAvailability(e instanceof Error?e.message:'Live testing is unavailable right now. Explore a sample report or retry.');}}
  finally{if(!controller.signal.aborted)setCatalogBusy(false);}
 }
 const operation=useRef(0),input=useRef<HTMLInputElement>(null),heading=useRef<HTMLHeadingElement>(null),abort=useRef<AbortController|null>(null);
 useEffect(()=>{const operations=operation;const timer=window.setTimeout(()=>void refreshModels(),0);return()=>{window.clearTimeout(timer);catalogAbort.current?.abort();abort.current?.abort();operations.current++;};},[]);
 function focus(){requestAnimationFrame(()=>heading.current?.focus());}
 async function load(file?:File,isExample=false){
  if(!file&&!isExample)return;const id=++operation.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError('');setNotice('');
  try{let text:string;if(isExample){const response=await fetch('/examples/benchmark.json',{signal:controller.signal});if(!response.ok)throw new Error('The example report could not be loaded. Please try again.');text=await response.text();}else{if(file!.size>262144)throw new Error('Choose a benchmark report smaller than 256 KB.');text=await file!.text();}
   const value=await inspectReport(text);if(id!==operation.current)return;setInspected(value);setLive(false);setExample(isExample);setResults(true);focus();
  }catch(e){if(id===operation.current)setError(e instanceof Error?e.message:'Unable to read this report.');}finally{if(id===operation.current)setBusy(false);}
 }
 function cancel(){operation.current++;abort.current?.abort();setBusy(false);setNotice('Import cancelled.');}
 function preset(value:string){setMode(value);setMeasured(value==='quick'?3:8);setWarmup(value==='quick'?1:2);setTokens(recommendedOutputTokens(models.find(m=>m.id===model)??{id:model,maxOutputTokens:256},value));setConcurrency(1);setTimeout(30);}
 function validate(){const result=configSchema.safeParse({model:'not-selected',measuredRequests:measured,warmupRequests:warmup,maxOutputTokens:tokens,concurrency,requestTimeoutMs:timeout*1000});setNotice(result.success?`Workload valid: ${measured+warmup} requests maximum. Settings are within the test budget.`:'These settings exceed the supported request budget.');}
 async function run(retryConfig?:BenchmarkConfig){
  const config=retryConfig??{model,measuredRequests:measured,warmupRequests:warmup,maxOutputTokens:tokens,concurrency,requestTimeoutMs:timeout*1000};
  const selected=models.find(m=>m.id===config.model);if(!selected)return;
  if(!configSchema.safeParse(config).success||config.maxOutputTokens>selected.maxOutputTokens){setError('These settings exceed the model or request budget. Lower the output limit.');return;}
  const id=++operation.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  setRunning(true);setPreparing(true);setRows({});setResults(false);setError('');setNotice('');
  try{
   const response=await fetch('/api/benchmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config),signal:controller.signal});
   await readLiveEvents(response,async event=>{
    if(id!==operation.current)return;
    if(event.type==='error')throw new Error(event.message);
    if(event.type==='progress'){setPreparing(false);const p=event.progress;if(p.stage!=='finished')setRows(old=>({...old,[p.index]:{stage:p.stage,status:p.status,outputBytes:old[p.index]?.outputBytes||0}}));}
    if(event.type==='activity')setRows(old=>({...old,[event.index]:{stage:old[event.index]?.stage||'measured',status:null,outputBytes:event.outputBytes}}));
    if(event.type==='report'){const report=await inspectReport(JSON.stringify(event.report));if(id!==operation.current)return;if(report.report.origin!=='live')throw new Error('The service returned a non-live report.');setInspected(report);setLive(true);setExample(false);setResults(true);setError(event.warning??'');focus();}
   });
  }catch(e){if(id===operation.current)setError(e instanceof Error?e.message:'The test could not complete. Try again.');}
  finally{if(id===operation.current)setRunning(false);}
 }
 function cancelRun(){operation.current++;abort.current?.abort();setRunning(false);setNotice('Test cancelled. You can start another test when the current requests have stopped.');focus();}
 function download(){if(!inspected)return;const url=URL.createObjectURL(new Blob([JSON.stringify(inspected.report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`veyra-${example?'example-':''}${inspected.report.runId}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const field=(label:string,value:number,set:(v:number)=>void,values:number[])=> <label className="vn-field">{label}<select aria-label={label} value={value} onChange={e=>{set(Number(e.target.value));setMode('custom');}}>{[...new Set([...values,value])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n}</option>)}</select></label>;
 const warmupStopped=!!(results&&inspected&&inspected.report.statistics.attempted===0&&inspected.report.requests.some(r=>r.phase==='warmup'&&['failed','timed_out','cancelled'].includes(r.status)));
 return <div className={`vn-workspace ${results?'vn-results':running?'vx-active':'vx-launch'} ${warmupStopped?'nf-workspace':''}`}><input ref={input} type="file" accept=".json,application/json" aria-label="Import benchmark report" tabIndex={-1} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/>
 {running?<RunProgress model={model} total={measured+warmup} warmups={warmup} rows={rows} preparing={preparing} onCancel={cancelRun}/>:results&&inspected?<><h1 ref={heading} tabIndex={-1} className={warmupStopped?'sr-only':undefined}>{example?'Explore an example report.':live?(inspected.report.statistics.attempted===0?'Your benchmark needs another try.':'Your benchmark results.'):'Your benchmark report.'}</h1>{example&&<p className="vn-example-note"><strong>Illustrative example · no live inference.</strong> This bundled JSON fixture demonstrates a successful request, a failure and a skipped request. Its values are synthetic, not provider performance measurements.</p>}<ReportView report={inspected.report} live={live} warning={error} onRetry512={live&&inspected.report.config.maxOutputTokens<512&&models.some(m=>m.id===inspected.report.config.model&&m.maxOutputTokens>=512)?()=>{
 const retry=configSchema.parse({...Object.fromEntries(['model','workload','measuredRequests','warmupRequests','concurrency','requestTimeoutMs'].map(key=>[key,inspected.report.config[key as keyof typeof inspected.report.config]])),maxOutputTokens:512});
 setTokens(512);setMode('custom');setModel(retry.model);setMeasured(retry.measuredRequests);setWarmup(retry.warmupRequests);setConcurrency(retry.concurrency);setTimeout(retry.requestTimeoutMs/1000);void run(retry);
 }:undefined} onReviewSettings={()=>{setResults(false);setReviewSettings(true);setError('');setNotice('Review the current launcher settings before starting a new run. No request has been sent and no token limit has been changed.');focus();}} summary={<div className="vn-success"><span>Request success rate</span><strong>{inspected.report.statistics.attempted===0?'Not measured':`${(inspected.report.statistics.successful/inspected.report.config.measuredRequests*100).toFixed(1)}%`}</strong><span>{inspected.report.statistics.attempted===0?`${inspected.report.requests.some(r=>r.phase==='warmup'&&['failed','timed_out','cancelled'].includes(r.status))?'The benchmark stopped during warm-up. ':''}No measured requests were attempted. ${inspected.report.statistics.skipped} skipped.`:`${inspected.report.statistics.successful} of ${inspected.report.config.measuredRequests} configured measured requests succeeded, including skipped requests in the denominator.`}</span></div>}/>{inspected.report.statistics.attempted>0&&<><div className="vn-verification-status"><h2>Verification status</h2><p>Execution evidence: <strong>{live?(inspected.report.schemaVersion===2?'Not requested':inspected.report.verification.failed?'Verification failed':inspected.report.verification.gpuTee?`${inspected.report.verification.gpuTee} GPU TEE responses verified`:inspected.report.verification.providerTee?`${inspected.report.verification.providerTee} model TEE responses verified`:inspected.report.verification.gateway?'Gateway signatures only · no model TEE proof':'Evidence unavailable'):'Not independently verified here'}</strong></p><ReceiptVerification key={JSON.stringify(inspected.report)} report={inspected.report}/></div><details className="vn-technical"><summary>Evidence and report fingerprints</summary><Evidence inspected={inspected} live={live}/></details></>}<div className="vn-results-top"><button className="vn-link" onClick={()=>{setResults(false);setError('');setNotice('');focus();}}>Back to launcher</button><div className="vn-actions"><button className="vn-link" onClick={()=>input.current?.click()}>Import report</button><button className="vn-button" onClick={download}>Export JSON</button></div></div></>:<><div className="vn-launch-heading"><p className="vn-eyebrow">Noxicon</p><h1 ref={heading} tabIndex={-1}>Know what your AI is actually delivering.</h1><p>Choose a model, run a focused test, and understand the result.</p></div><div className="vl-launch-shell">
 <section className="vl-configuration" aria-labelledby="launcher-title">
  <div className="vl-section-heading"><h2 id="launcher-title">Start a benchmark</h2><span>{providerName}</span></div>
  <div className="vl-model">
   <div className="vl-model-label"><label htmlFor="benchmark-model">Model</label><button className="vl-refresh" aria-label="Refresh models" aria-busy={catalogBusy} disabled={catalogBusy} onClick={()=>void refreshModels()}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M16 7a6 6 0 1 0 .3 5M16 3v4h-4"/></svg><span>{catalogBusy?'Refreshing…':'Refresh'}</span></button></div>
   <div className="vn-field"><select id="benchmark-model" value={model} disabled={!models.length||catalogBusy} onChange={e=>{setModel(e.target.value);setTokens(recommendedOutputTokens(models.find(m=>m.id===e.target.value)??{id:e.target.value,maxOutputTokens:256},mode));}} aria-describedby="model-help">{!models.length&&<option value="">{catalogBusy?'Finding models…':'No models available'}</option>}{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
   <p id="model-help" className="vl-availability" aria-live="polite">{catalogBusy?'Checking available models…':availability}</p>
  </div>
  {reviewSettings&&tokens<Math.min(512,models.find(m=>m.id===model)?.maxOutputTokens??tokens)&&<div className="vl-recovery"><p>Try a larger output limit before starting a new run.</p><button className="vn-button" onClick={()=>{setTokens(Math.min(512,models.find(m=>m.id===model)?.maxOutputTokens??tokens));setMode('custom');setNotice('Output limit updated. Review the settings, then select Start benchmark. No request has been sent.');}}>Use {Math.min(512,models.find(m=>m.id===model)?.maxOutputTokens??tokens)}-token limit</button></div>}
  <div className="vn-test-choice" role="group" aria-label="Test depth">
   <button aria-pressed={mode==='quick'} onClick={()=>preset('quick')}><strong>Quick test</strong><span>3 measured requests · a first look</span></button>
   <button aria-pressed={mode==='detailed'} onClick={()=>preset('detailed')}><strong>Detailed test</strong><span>8 measured requests · a wider view</span></button>
  </div>
  <details className="vl-advanced" open={reviewSettings||undefined}><summary>Advanced settings</summary>
   <div className="vl-advanced-body"><div className="vn-advanced-grid">
    {field('Measured requests',measured,setMeasured,[1,2,3,4,5,6,7,8])}
    {field('Warm-up requests',warmup,setWarmup,[0,1,2])}
    {field('Output token limit',tokens,setTokens,[16,32,64,96,128,256,512])}
    {field('Concurrency',concurrency,setConcurrency,[1,2])}
    {field('Request timeout (seconds)',timeout,setTimeout,[1,10,30,60])}
   </div>
   <p className="vl-budget">{mode==='custom'?'Custom settings. ':''}{measured+warmup} requests maximum · 120-second deadline · Temperature 0 · Top-p 1</p>
   <details className="vl-prompts"><summary>View fixed prompts</summary><p>{workload.system}</p><ol>{workload.prompts.map(p=><li key={p}>{p}</li>)}</ol></details>
   <button className="vn-link" onClick={validate}>Check configuration</button></div>
  </details>
  <button className="vn-button vl-start" onClick={()=>void run()} disabled={!model||catalogBusy||busy} aria-describedby="model-help">Start benchmark</button>
 </section>
 <section className="vl-reports" aria-labelledby="reports-title">
  <div className="vl-section-heading"><h2 id="reports-title">Explore a report</h2></div>
  <div className="vl-report-actions"><button className="vn-button" onClick={()=>void load(undefined,true)} disabled={busy}>View sample report</button><button className="vn-button" onClick={()=>input.current?.click()} disabled={busy}>Import report</button></div>
  <p className="vl-privacy">Your imported report stays in this browser. No upload or account required.</p>
  
 </section>
 </div></>}
 {busy&&<div className="vn-feedback" role="status"><span className="vn-progress"/>Reading and validating report…<button className="vn-link" onClick={cancel}>Cancel import</button></div>}{error&&!(results&&inspected)&&<p className="vn-feedback" role="alert">{error}</p>}{notice&&<p className="vn-feedback" role="status">{notice}</p>}
 </div>;
}
