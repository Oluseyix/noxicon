'use client';
import { useEffect, useRef, useState } from 'react';
import type { Evidence } from '../lib/challenges';
import { explanationRequest, type AiExplanation } from '../lib/ai-contract';

export default function AiExplanationPanel({evidence,allowed}:{evidence:Evidence;allowed:boolean}) {
  const [models,setModels]=useState<string[]>([]),[model,setModel]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [answer,setAnswer]=useState<AiExplanation|null>(null);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function call(path:string,body?:unknown) {
    const controller=new AbortController();active.current=controller;
    const timer=setTimeout(()=>controller.abort(),110000);
    try {
      const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error?.message||'NEAR AI is unavailable. No AI output was released.');
      return data;
    } finally {clearTimeout(timer);}
  }
  async function loadModels(){
    setBusy(true);setError('');
    try {const data=await call('/api/ai/models');setModels(data.models);setModel(data.models[0]??'');}
    catch(e){setError(e instanceof Error?e.message:'Could not load models.');}finally{setBusy(false);}
  }
  async function run(){
    if(!allowed||!model||busy)return;
    setBusy(true);setError('');setAnswer(null);
    try {setAnswer(await call('/api/ai/explain',explanationRequest(evidence,model)));}
    catch(e){setError(e instanceof Error&&e.name!=='AbortError'?e.message:'Request cancelled or timed out. No verified AI output is available.');}finally{setBusy(false);}
  }
  return <section className="section-block ai-panel"><p className="eyebrow">04 / OPTIONAL AI COMMENTARY</p><h3>Explain the approved result</h3>
    <p className="muted">AI commentary is separate from the financial engine and may be inaccurate. The engine results above are authoritative for these supplied records. Financial calculations are not TEE-attested. No blockchain publication occurs.</p>
    {!allowed?<p className="muted">The founder has not approved sending these aggregates to NEAR AI. Enable optional AI disclosure in the founder workspace.</p>:<>
      <p className="muted">The founder approved sending only this calculation’s aggregate fields and definition. No CSV rows, identifiers, filenames, salt or commitments are sent to NEAR AI.</p>
      <div className="inline-actions"><button className="button outline small" disabled={busy} onClick={loadModels}>Load live models</button>{models.length>0&&<label className="evidence-select">NEAR AI model<select value={model} disabled={busy} onChange={e=>{setModel(e.target.value);setAnswer(null);}}>{models.map(id=><option key={id} value={id}>{id}</option>)}</select></label>}<button className="button dark small" disabled={busy||!model} onClick={run}>{busy?'Contacting NEAR AI / verifying…':'Generate & verify explanation'}</button></div>
      <p className="muted">Catalog availability is not verification. This flow requires model TEE evidence, verified GPU evidence, an up-to-date TCB and a valid response signature; unsupported models fail without fallback.</p>
    </>}
    {error&&<p role="alert" className="ai-error">{error}</p>}
    {answer&&<div className="ai-answer"><span className="tag approved">AI INFERENCE SIGNATURE VERIFIED</span><p style={{whiteSpace:'pre-wrap'}}>{answer.text}</p><dl className="result-list"><div><dt>Model</dt><dd>{answer.model}</dd></div><div><dt>Completion</dt><dd>{answer.completionId}</dd></div><div><dt>Verified at</dt><dd>{answer.verifiedAt}</dd></div><div><dt>Signature</dt><dd>{answer.verification.signatureKind}</dd></div><div><dt>Gateway TLS / GPU</dt><dd>{answer.verification.gatewayTls} / {answer.verification.gpuEvidence}</dd></div><div><dt>Model TCB</dt><dd>{answer.verification.tcbStatuses.join(', ')}</dd></div></dl><details><summary>Attested model signers and limitations</summary>{answer.verification.signers.map((signer,i)=><code key={i}>{signer}<br/></code>)}<p>Hardware evidence and the response signature were checked by the server using the official SDK. Deployment image provenance and an application-specific measurement allowlist were not checked. This is not independent browser verification or proof of financial truth.</p></details></div>}
  </section>;
}
