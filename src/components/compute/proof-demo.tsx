'use client';
import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import original from '../../../evidence/groq-report.json';
import receipt from '../../../evidence/near-testnet-receipt.json';
import { publicationPreview } from '../../lib/compute/publication-preview';
import { statistics } from '../../lib/compute/metrics';
import { validateReport } from '../../lib/compute/report';
import { z } from 'zod';

const responseSchema=z.object({result:z.object({verified:z.boolean(),status:z.enum(['verified','mismatch','failed','pending','unavailable','invalid']),code:z.string().max(100),message:z.string().max(1000)}),checkedAt:z.iso.datetime(),transactionHash:z.literal(receipt.transactionHash),publisher:z.literal('veyra-proof.testnet'),network:z.literal('testnet')});
type Check=z.infer<typeof responseSchema>;
type Edit='original'|'model'|'timing';
const measured=original.requests[0];
function workingCopy(edit:Edit){
 const copy=validateReport(structuredClone(original));
 if(edit==='model')copy.config={...copy.config,model:'modified/model'};
 if(edit==='timing'){
  copy.requests[0].latencyMs!+=10;
  copy.requests[0].throughputTokensPerSecond=copy.requests[0].outputTokens!/(copy.requests[0].latencyMs!/1000);
  copy.statistics=statistics(copy.requests);
 }
 return copy;
}
function CopyValue({value,label}:{value:string;label:string}){
 const [feedback,setFeedback]=useState('');
 async function copy(){try{await navigator.clipboard.writeText(value);setFeedback('Copied');}catch{setFeedback('Copy unavailable. Select the full value in Technical evidence.');}}
 return <span className="lab-copy"><button disabled={!value} onClick={()=>void copy()} aria-label={`Copy ${label}`}>{feedback==='Copied'?'Copied':'Copy'}</button><span className={feedback==='Copied'?'sr-only':'lab-copy-feedback'} role="status">{feedback}</span></span>;
}
function RequestReplay(){
 const [position,setPosition]=useState(0),[playing,setPlaying]=useState(false);
 const frame=useRef<number|null>(null);
 const stop=()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;setPlaying(false);};
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 function replay(){
  stop();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){setPosition(measured.latencyMs);return;}
  setPosition(0);setPlaying(true);const start=performance.now();
  const tick=(now:number)=>{const fraction=Math.min(1,(now-start)/2000);setPosition(fraction*measured.latencyMs);if(fraction<1)frame.current=requestAnimationFrame(tick);else{frame.current=null;setPlaying(false);}};
  frame.current=requestAnimationFrame(tick);
 }
 const first=measured.ttftMs/measured.latencyMs*100;
 const phase=position>=measured.latencyMs?'Recorded completion':position>=measured.ttftMs?'Receiving content until completion':'Waiting for first content';
 return <section className="lab-replay" aria-labelledby="replay-title">
  <div className="lab-section-head">
    <h2 id="replay-title">Request Replay</h2>
    <button className="lab-text-button" onClick={replay}>{playing?'Restart replay':'Replay request'}</button>
  </div>
  <p className="lab-replay-lead">Replay or scrub the recorded timing.</p>
  <div className="lab-playback" aria-label="Historical request timeline">
    <div className="lab-track">
      <span className="lab-wait" style={{width:`${first}%`}}/>
      <span className="lab-receive"/>
      <span className="lab-arrival" style={{left:`${first}%`}}/>
      <span className="lab-playhead" style={{left:`${position/measured.latencyMs*100}%`}}/>
    </div>
    <input aria-label="Historical replay position in milliseconds" type="range" min={0} max={measured.latencyMs} step="0.001" value={position} onChange={e=>{stop();setPosition(Number(e.target.value));}}/>
    <div className="lab-timestamps">
      <button onClick={()=>{stop();setPosition(0);}} title="Request dispatched: 0 ms">0 ms</button>
      <button onClick={()=>{stop();setPosition(measured.ttftMs);}} title={`${measured.ttftMs} ms — first visible content`}>235.6 ms</button>
      <button onClick={()=>{stop();setPosition(measured.latencyMs);}} title={`${measured.latencyMs} ms — completed`}>356.1 ms</button>
    </div>
  </div>
  <div className="lab-replay-readout">
    <strong>{position.toFixed(1)} <span>ms</span></strong>
    <span>{phase}</span>
  </div>
  <p className="lab-replay-note">Historical timing · Replay slowed to 2 seconds</p>
 </section>;
}
export default function ProofDemo(){
 const [edit,setEdit]=useState<Edit>('original');
 const [digest,setDigest]=useState(''),[hashError,setHashError]=useState('');
 const [unavailable,setUnavailable]=useState(false);
 const [stage,setStage]=useState<'idle'|'hashing'|'lookup'>('idle'),[check,setCheck]=useState<Check|null>(null),[error,setError]=useState('');
 const abort=useRef<AbortController|null>(null);
 const busy=stage!=='idle',changed=edit!=='original';
 useEffect(()=>()=>abort.current?.abort(),[]);
 useEffect(()=>{
  let active=true;
  void publicationPreview(workingCopy(edit)).then(value=>{if(active)setDigest(value);}).catch(()=>{if(active)setHashError('Unable to calculate the publication digest. No match is claimed.');});
  return()=>{active=false;};
 },[edit]);
 function selectEdit(value:Edit){if(value===edit)return;setDigest('');setHashError('');setEdit(value);}
 async function verify(){
  setStage('hashing');setError('');setUnavailable(false);setCheck(null);
  let rpcUnavailable=false;abort.current=new AbortController();
  const timer=setTimeout(()=>abort.current?.abort(),45000);
  try{
   const calculated=await publicationPreview(validateReport(structuredClone(original)));
   if(calculated!==receipt.commitment)throw new Error('Original report does not match its receipt. No RPC verification was attempted.');
   abort.current.signal.throwIfAborted();setStage('lookup');
   rpcUnavailable=true;
   const response=await fetch('/api/demo/verify',{method:'POST',signal:abort.current.signal});
   if(!response.ok)throw new Error(response.status===429?'Verification is busy or rate limited. Try again later.':'Public Testnet verification is unavailable. Try again when RPC access is restored.');
   rpcUnavailable=false;
   const parsed=responseSchema.safeParse(await response.json().catch(()=>null));
   if(!parsed.success)throw new Error('The verification response was invalid. No verified result is available.');
   setCheck(parsed.data);
  }catch(e){setUnavailable(rpcUnavailable);setError(e instanceof Error&&e.name!=='AbortError'?e.message:'Verification timed out or was cancelled. No verified result is available.');}
  finally{clearTimeout(timer);setStage('idle');}
 }
 function download(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const verified=check?.result.verified&&check.result.status==='verified'&&check.result.code==='commitment_verified';
 const localMatch=!!digest&&digest===receipt.commitment;
 const status=busy?'Checking':unavailable||check?.result.status==='unavailable'?'Network unavailable':verified?'Verified':check?.result.status==='pending'?'Pending':error||check?'Verification failed':'Not checked';
 return <div className="lab-page"><a className="lab-skip" href="#main">Skip to content</a><header className="lab-nav"><Link href="/" aria-label="Noxicon home" className="lab-brand">noxicon.</Link></header>
 <main id="main" tabIndex={-1} className="lab-main">
  <div className="lab-heading">
    <div>
      <p className="lab-eyebrow">EVIDENCE DASHBOARD</p>
      <h1>Evidence Laboratory</h1>
      <p className="lab-lead">Verify a recorded run. See what changes when evidence changes.</p>

    </div>
    <span className="lab-network">NEAR Testnet</span>
  </div>
  <div className="lab-workspace">
   <section className="lab-summary" aria-labelledby="summary-title">
     <div className="lab-section-head">
       <h2 id="summary-title">The recorded run</h2>
       <span className="lab-claim-spec">Groq · Historical run</span>
     </div>
     <div className="lab-metrics">
       <div><strong>{measured.latencyMs.toFixed(1)}<small>ms</small></strong><span>Total observed latency</span></div>
       <div><strong>{measured.ttftMs.toFixed(1)}<small>ms</small></strong><span>First visible content</span></div>
       <div><strong>1</strong><span>Measured request</span></div>
     </div>
     <p className="lab-output">32 reported tokens · Output limit reached</p>
   </section>
   <section className={`lab-verification ${verified?'is-verified':''}`} aria-labelledby="verification-title">
     <div className="lab-section-head">
       <span className="lab-eyebrow">PUBLIC RECORD CHECK</span>
       <span className="lab-status">{status}</span>
     </div>
     <div className="lab-verdict" role="status" aria-live="polite">
       <div className={`lab-seal ${busy?'is-pending':''}`} aria-hidden="true">{busy?'…':verified?'✓':error||check&&!verified?'!':'?'}</div>
       <h2 id="verification-title">{busy?'Checking publication…':verified?'Evidence verified':status==='Network unavailable'?'Verification unavailable':status==='Pending'?'Publication not finalized':error||check?'Verification failed':'Ready to verify'}</h2>
       <p role={error?'alert':undefined}>{busy?(stage==='hashing'?'Computing the original report commitment.':'Looking up the finalized NEAR transaction.'):verified?'The original report matches its finalized public record.':error||check?.result.message||'Check this report against its public NEAR record.'}</p>
     </div>
     <button className="lab-primary" disabled={busy} onClick={()=>void verify()}>{busy?'Checking NEAR…':'Verify on NEAR'}</button>
     {check&&<p className="lab-checked">Original checked {new Date(check.checkedAt).toISOString()} · archival Testnet RPC</p>}
   </section>
   <section className={`lab-editor ${changed?'is-modified':''}`} aria-labelledby="editor-title">
     <div className="lab-section-head">
       <h2 id="editor-title">Challenge the evidence</h2>
       {changed&&<button className="lab-text-button" onClick={()=>selectEdit('original')}>Restore original</button>}
     </div>
     <p>Edit a copy to see whether it still matches the published fingerprint.</p>
     <div className="lab-edit-buttons" role="group" aria-label="Evidence experiment">
       <button aria-pressed={edit==='model'} onClick={()=>selectEdit('model')}>Change model</button>
       <button aria-pressed={edit==='timing'} onClick={()=>selectEdit('timing')}>Add 10 ms latency</button>
     </div>
     <div className="lab-change" role="status" aria-live="polite">
       {changed?<><span className="lab-change-label">{edit==='model'?'Model identifier changed':'Total latency changed'}</span>
       <div className="lab-change-values">
         <div><span>Original</span><del>{edit==='model'?original.config.model:`${measured.latencyMs.toFixed(3)} ms`}</del></div>
         <div><span>Modified copy</span><ins>{edit==='model'?'modified/model':`${(measured.latencyMs+10).toFixed(3)} ms`}</ins></div>
       </div>
       <p>The original record stays unchanged.</p></>
       :<><span className="lab-change-label">Original evidence is intact</span>
       <div className="lab-change-values"><div><span>Original latency</span><strong>{measured.latencyMs.toFixed(1)} ms</strong></div><div><span>Your copy</span><strong>{measured.latencyMs.toFixed(1)} ms</strong></div></div></>}
     </div>
     <div className={`lab-experiment-status ${changed?'is-changed':''}`} role="status">{hashError||(!digest?'Calculating fingerprint…':localMatch?'✓ Copy unchanged':'≠ Fingerprint mismatch')}<span>Local comparison · Original NEAR result preserved</span></div>
   </section>
   <RequestReplay/>
  </div>
  <details className="lab-technical"><summary>Technical evidence<span>Report, publication & reproduction</span></summary><div className="lab-technical-groups">
  <details><summary>Report</summary><dl><div><dt>Actual provider / model</dt><dd>Groq · {original.config.model}</dd></div><div><dt>Run ID</dt><dd>{original.runId}</dd></div><div><dt>Exact original timing</dt><dd>Total: {measured.latencyMs} ms<br/>First content: {measured.ttftMs} ms</dd></div><div><dt>Changed field</dt><dd>{edit==='model'?'/config/model':edit==='timing'?'/requests/0/latencyMs; derived throughput and statistics':'None'}</dd></div></dl><button onClick={()=>download(original,'noxicon-historical-report.json')}>Download genuine report</button><p>One request, output limit reached. A smoke test only, with self-recorded observations—not independent proof of inference execution.</p></details>
  <details><summary>Publication</summary><dl><div><dt>Network / publisher</dt><dd>NEAR Testnet · {receipt.publisher}</dd></div><div><dt>Transaction</dt><dd><a href={receipt.explorerUrl} target="_blank" rel="noreferrer">{receipt.transactionHash}</a></dd></div><div><dt>Published commitment</dt><dd><code>{receipt.commitment}</code><CopyValue value={receipt.commitment} label="full published commitment"/></dd></div><div><dt>Current commitment</dt><dd><code>{digest}</code><CopyValue key={digest} value={digest} label="full current commitment"/></dd></div><div><dt>Actual RPC result</dt><dd>{check?`${check.result.code}: ${check.result.message}`:'Not checked in this session.'}</dd></div></dl><button onClick={()=>download(receipt,'noxicon-historical-receipt.json')}>Download matching receipt</button><p>Verification trusts archival-rpc.testnet.near.org. This is not a light-client inclusion proof. Testnet can reset or become unavailable. Verification always checks the original historical report, never an edited copy.</p></details>
  <details><summary>Reproduce</summary><p>From a clone of this project, install dependencies, then run the independent check. Follow the root README for the supported Node version and setup.</p><pre>npm ci{'\n'}npm run verify:demo</pre><CopyValue value={'npm ci\nnpm run verify:demo'} label="verification commands"/><p>Compare exported evidence offline:</p><pre>npm run proof:compare -- BEFORE.json AFTER.json</pre><CopyValue value="npm run proof:compare -- BEFORE.json AFTER.json" label="comparison command"/><p>No credentials required for this historical check. Own-report publication remains an explicitly authorized operator workflow. This page never signs or broadcasts.</p></details>
  </div></details></main></div>;
}
