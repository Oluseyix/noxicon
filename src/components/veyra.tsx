'use client';

import { useRef, useState } from 'react';
import { parseCsv, percentage, type RecordRow } from '../lib/finance';
import { challengeOptions, createEvidence, disclosure, money, type ChallengeKind, type Evidence } from '../lib/challenges';

type Dataset = {rows:RecordRow[];name:string;fictional:boolean;salt:string};
const labels:Record<string,string>={currency:'Currency',period:'Period',returningCents:'Numerator · returning customer payments',denominatorCents:'Denominator',share:'Returning share',customerPaymentsCents:'Customer payments',internalCents:'Internal transfers',unclassifiedCents:'Unclassified transfers',totalCents:'Total transfers'};
function Result({result}:{result:ReturnType<typeof disclosure>}) {
  return <dl className="result-list">{Object.entries(result).map(([key,value])=><div key={key}><dt>{labels[key]||key}</dt><dd>{key.endsWith('Cents')?money(value!):value??'Undefined — zero denominator'}</dd></div>)}</dl>;
}
function download(evidence:Evidence) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`veyra-${evidence.kind}-evidence.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function dataset(csv:string,name:string,fictional:boolean):Dataset {
  const rows=parseCsv(csv);
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  return {rows,name,fictional,salt};
}

export default function Veyra() {
  const [data,setData]=useState<Dataset|null>(null);
  const [kind,setKind]=useState<ChallengeKind|null>(null);
  const [evidence,setEvidence]=useState<Partial<Record<ChallengeKind,Evidence>>>({});
  const [approved,setApproved]=useState<ChallengeKind[]>([]);
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [feedbackTarget,setFeedbackTarget]=useState<'challenge'|'records'|'results'>('challenge');
  const operation=useRef(0);
  const current=kind?evidence[kind]:undefined;
  const fictional=data?.fictional??true;
  const canExport=Boolean(current&&(fictional||approved.includes(current.kind)));

  function install(next:Dataset) {
    setData(next);setKind(null);setEvidence({});setApproved([]);setConsent(false);
  }
  async function fetchSample() {
    const response=await fetch('/samples/financial-records.csv');
    if(!response.ok)throw new Error('Could not load the sample records. Try a question again or import your own CSV.');
    return dataset(await response.text(),'Fictional sample company',true);
  }
  async function loadSample() {
    setFeedbackTarget('records');
    const id=++operation.current;setBusy(true);setError('');setNotice('');
    try {const next=await fetchSample();if(id!==operation.current)return;install(next);setNotice('Fictional sample loaded. Choose a question to investigate the claim.');}
    catch(e){if(id===operation.current)setError(e instanceof Error?e.message:'Could not load the sample records.');}
    finally{if(id===operation.current)setBusy(false);}
  }
  async function upload(file?:File) {
    if(!file)return;
    setFeedbackTarget('records');
    const id=++operation.current;setBusy(true);setError('');setNotice('');
    try {
      if(file.size>5_000_000)throw new Error('Choose a CSV smaller than 5 MB.');
      const next=dataset(await file.text(),file.name,false);
      if(id!==operation.current)return;install(next);setNotice('Private records loaded locally. Previous results and disclosure approvals have been cleared.');
    }catch(e){if(id===operation.current)setError(`Could not import CSV: ${e instanceof Error?e.message:'The file could not be read.'}`);}
    finally{if(id===operation.current)setBusy(false);}
  }
  async function challenge(nextKind:ChallengeKind) {
    if(busy)return;
    setFeedbackTarget('challenge');
    const id=++operation.current;setKind(nextKind);setConsent(false);setBusy(true);setError('');setNotice('');
    try {
      const source=data??await fetchSample();
      const answer=evidence[nextKind]??await createEvidence(source.rows,nextKind,source.salt);
      if(id!==operation.current)return;
      setData(source);setEvidence(prev=>({...prev,[nextKind]:answer}));
      setNotice('Calculation ready. Inspect the result below.');
      requestAnimationFrame(()=>{const heading=document.getElementById('results-heading');heading?.focus({preventScroll:true});heading?.scrollIntoView?.({block:'start'});});
    }catch(e){if(id===operation.current)setError(e instanceof Error?e.message:'Could not calculate evidence. Use HTTPS or localhost with Web Crypto and try again.');}
    finally{if(id===operation.current)setBusy(false);}
  }
  function approve() {
    if(!current||!consent||busy)return;
    setFeedbackTarget('results');
    setApproved(prev=>prev.includes(current.kind)?prev:[...prev,current.kind]);setConsent(false);
    setNotice('This exact aggregate disclosure is approved for download. Nothing has been sent or published.');
  }

  function feedback(target:typeof feedbackTarget) {
    return feedbackTarget===target?<>{error&&<div className="inline-feedback error" role="alert">{error}</div>}{notice&&<p className="inline-feedback" role="status">{notice}</p>}</>:null;
  }

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header"><a className="wordmark" href="#main" aria-label="Noxicon home"><span className="brand-mark" aria-hidden="true">N</span>noxicon<span className="brand-period">.</span></a><a className="text-link" href="#records">Import records</a></header>
    <main id="main" className="claim-workspace" tabIndex={-1}>
      <section className="claim-intro" aria-labelledby="claim-heading">
        <div><p className="eyebrow">{fictional?'FICTIONAL COMPANY · OCTOBER 2026':'YOUR RECORDS · SEPTEMBER–OCTOBER 2026'}</p>
          <h1 id="claim-heading">{fictional?<>“We processed $1 million in October, <em>mostly from returning customers.</em>”</>:<>Your records.<br/><em>A clearer picture.</em></>}</h1>
          <p className="claim-lede">{fictional?'A confident statement. What do the underlying records actually support? Choose a question to investigate the claim.':'Investigate returning customer payments and transfer classifications. Results stay in this local owner session until you explicitly approve an aggregate export.'}</p>
        </div>
        <aside className="claim-context"><p className="eyebrow">{fictional?'THE QUESTION BEHIND THE CLAIM':'PRIVATE SOURCE MATERIAL'}</p><h2>{fictional?'“Mostly” — relative to what?':'Same questions. Your evidence.'}</h2><p>{fictional?'All transfers and classified customer payments are different denominators. The same records can produce two different answers.':'Your imported records replace the fictional dataset. The sample company’s statement does not apply to your data.'}</p><a className="text-link" href="#records">{data?'Inspect the underlying records':'View the sample format'}</a></aside>
      </section>

      <section id="challenge" className="claim-stage" aria-labelledby="challenge-heading">
        <div className="section-title"><div><p className="eyebrow">01 / CHALLENGE THE CLAIM</p><h2 id="challenge-heading">What would you like to understand?</h2></div></div>
        <p className="muted">{fictional?'These three aggregate disclosures are preapproved for the fictional sample. Select a question to calculate its answer.':'Choose a question for a private preview. Each aggregate disclosure needs your explicit approval before it can be downloaded.'}</p>
        <div className="challenge-grid" role="group" aria-label="Supported questions">{challengeOptions.map((option,i)=><button key={option.kind} className={`challenge-option ${kind===option.kind?'selected':''}`} aria-pressed={kind===option.kind} aria-controls="results" disabled={busy} onClick={()=>void challenge(option.kind)}><span className="question-number">0{i+1}</span><strong>{option.title}</strong><span>{option.description}</span><small>{kind===option.kind?(busy?'Calculating…':'Selected question'):'Investigate'}</small></button>)}</div>
        {feedback('challenge')}
      </section>

      <section id="results" className="claim-stage" aria-labelledby="results-heading" aria-busy={busy}>
        <div className="section-title"><div><p className="eyebrow">02 / REVEAL THE EVIDENCE</p><h2 id="results-heading" tabIndex={-1}>{current?'The answer depends on the definition.':'A claim becomes clearer with evidence.'}</h2></div>{current&&<span className="tag">{fictional?'Fictional sample':canExport?'Approved for export':'Private preview'}</span>}</div>
        {!current?<div className="result-placeholder"><p>{busy?'Reading records and calculating evidence…':'Select a question above to reveal the calculated result, its definition and the supporting evidence.'}</p></div>:<>
          <div className="evidence-summary"><div><p className="eyebrow">{current.kind==='breakdown'?'TOTAL OCTOBER TRANSFERS':'RETURNING CUSTOMER SHARE'}</p><div className="result-number">{current.kind==='breakdown'?money(current.result.totalCents!):current.result.share??'Undefined'}</div><p>{current.kind==='all'?'of all October transfers':current.kind==='classified'?'of classified October customer payments':'across the supplied transfer classifications'}</p><p className="calculation-caption">Calculated from {data!.rows.length} supplied records using the financial engine.</p></div><div><h3 className="result-detail-title">{current.kind==='breakdown'?'What makes up the total':'The numerator and denominator'}</h3><Result result={current.result}/></div></div>
          {current.kind==='breakdown'?<div className="breakdown-bars" aria-label="Transfer classification shares">{[['Customer payments',current.result.customerPaymentsCents],['Internal',current.result.internalCents],['Unclassified',current.result.unclassifiedCents]].map(([name,value])=>{const share=percentage(BigInt(value!),BigInt(current.result.totalCents!));return <div key={name}><span>{name}</span><div className="bar-track"><div style={{width:share??'0%'}}/></div><strong>{share??'Undefined'}</strong></div>;})}</div>:<p className="result-explanation">The numerator is October customer payments from customer IDs that also made a classified payment in September. {current.kind==='all'?'The denominator includes all October transfers, including internal and unclassified transfers.':'The denominator includes only October transfers classified as customer payments; internal and unclassified transfers are excluded.'}</p>}
          {fictional&&<div className="definition-comparison" aria-label="Compare denominator definitions"><div><h3>Same numerator. Different denominator.</h3><p>Changing the definition changes the interpretation, not the records. “Mostly” needs a stated denominator.</p></div>{(['all','classified'] as const).map(comparisonKind=>{const result=disclosure(data!.rows,comparisonKind);return <button key={comparisonKind} disabled={busy} onClick={()=>void challenge(comparisonKind)} aria-label={`Inspect ${comparisonKind==='all'?'all transfers':'customer payments'} definition`}><span>{comparisonKind==='all'?'All transfers':'Classified customer payments'}</span><strong>{result.share??'Undefined'}</strong><small>{money(result.returningCents!)} / {money(result.denominatorCents!)}</small></button>;})}</div>}
          {!fictional&&<div className="disclosure-control"><h3>{canExport?'This disclosure is approved for download.':'Keep the preview private, or approve this disclosure.'}</h3><p>Approval applies only to the aggregate fields shown above, this calculation’s definition and its commitments. Raw rows, identifiers, filenames and the private salt are excluded from the export.</p>{!canExport&&<><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/><span>I approve exporting this exact aggregate disclosure.</span></label><button className="button dark" disabled={!consent||busy} onClick={approve}>Approve disclosure</button></>}<p className="muted">Nothing is automatically sent or published. This is one local owner session, not secure multi-user access control.</p></div>}
        </>}
        {feedback('results')}
      </section>

      <section id="verification" className="claim-stage" aria-labelledby="verification-heading"><div className="section-title"><div><p className="eyebrow">03 / INSPECT VERIFICATION</p><h2 id="verification-heading">Know what the evidence can tell you.</h2></div>{current&&<button className="button outline" disabled={!canExport||busy} onClick={()=>{if(canExport)download(current);}}>Download evidence JSON</button>}</div>
        <div className="evidence-columns"><div><h3>The calculation, in full.</h3>{current?<dl className="result-list">{Object.entries(current.definition).map(([key,value])=><div key={key}><dt className="capitalize">{key}</dt><dd>{value}</dd></div>)}</dl>:<p className="muted">Choose a question to inspect its precise calculation definition and data commitments.</p>}<p className="muted">September and October 2026, UTC. USD integer cents. Percentages round half up to two decimal places; a zero denominator has no defined percentage.</p></div><div><h3>Assumptions and limitations.</h3><ul className="limitations"><li>Classifications, customer identity continuity and wallet mappings are company-supplied assumptions.</li><li>Record authenticity and completeness are not independently verified.</li><li>SHA-256 commitments bind inputs, definitions and results. They do not establish financial truth.</li><li>Financial calculations run in this browser and are not TEE-attested.</li><li>No AI attestation has been obtained for this result. No testnet receipt has been published.</li></ul></div></div>
        {current&&<details className="commitments"><summary>Inspect SHA-256 data commitments</summary><div>{Object.entries(current.commitments).map(([key,value])=><div className="hash-row" key={key}><span className="capitalize">{key} · SHA-256</span><code>{value}</code></div>)}</div><p className="muted">Protocol v1 · Unpublished. A random 32-byte salt remains private in this session. Reproducing these commitments requires the original records and salt. The evidence export contains only approved aggregates, definitions and hashes. Refreshing clears the session.</p></details>}
      </section>

      <section id="records" className="claim-stage records-section" aria-labelledby="records-heading"><div className="section-title"><div><p className="eyebrow">SOURCE MATERIAL</p><h2 id="records-heading">Inspect the records. Or bring your own.</h2></div><label className={`button outline ${busy?'disabled':''}`}>Import CSV<input type="file" aria-label="Import CSV" accept=".csv,text/csv" disabled={busy} onChange={event=>{void upload(event.target.files?.[0]);event.target.value='';}}/></label></div>
        <p className="muted">Imported records stay in your browser. They are not uploaded to a server or sent to AI. Replacing records clears results and approvals; an invalid import leaves the current dataset intact. Refreshing clears all records.</p>
        {feedback('records')}
        <div className="source-meta"><span className="tag">{fictional?'Fictional sample data':'Private imported records'}</span><span>{data?`${data.name} · ${data.rows.length} records`:'Bundled September–October 2026 sample'}</span></div>
        <div className="inline-actions"><a className="text-link" href="/samples/financial-records.csv" download>Download sample CSV</a><button className="text-link" disabled={busy} onClick={()=>void loadSample()}>{fictional?'Load sample records':'Use fictional sample instead'}</button></div>
        <details className="schema"><summary>CSV format and supported periods</summary><p>USD only. September and October 2026. Maximum 5 MB. Required columns: transaction_id, date, currency, amount, customer_id, sender, recipient, classification. Dates use YYYY-MM-DD. Amounts are nonnegative with exactly two decimal places. Classifications are customer_payment, internal or unclassified. Customer payments require a customer ID. Duplicate IDs, invalid rows and extra columns reject the entire file.</p></details>
        {data&&<details className="records-details"><summary>Inspect {data.rows.length} underlying records{!fictional?' · visible only in this browser':''}</summary><div className="table-scroll" tabIndex={0} aria-label="Financial records, scroll horizontally"><table><caption>{fictional?'Entirely fictional source records':'Private source records · local owner view'}</caption><thead><tr><th>Date (UTC)</th><th>Transaction</th><th>Customer</th><th>Sender / recipient</th><th>Classification</th><th className="numeric">Amount (USD)</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.transaction_id}><td>{row.date}</td><td>{row.transaction_id}</td><td>{row.customer_id||'—'}</td><td>{row.sender} / {row.recipient}</td><td>{row.classification.replaceAll('_',' ')}</td><td className="numeric">{money(row.amount.replace('.',''))}</td></tr>)}</tbody></table></div></details>}
      </section>
    </main><footer className="site-footer"><span className="footer-brand">noxicon.</span><p>Challenge claims. Understand the evidence.</p></footer>
  </>;
}
