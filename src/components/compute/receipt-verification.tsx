'use client';
import { useEffect, useRef, useState } from 'react';
import type { InspectedReport } from '../../lib/compute/report-browser';
const labels:Record<string,string>={verified:'Publication verified',mismatch:'Receipt does not match',failed:'Publication failed',pending:'Transaction not final',unavailable:'Verification unavailable',invalid:'Invalid receipt or report'};
export default function ReceiptVerification({report}:{report:InspectedReport['report']}){
 const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(false),[result,setResult]=useState<{status:string;message:string;publisher?:string}|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function check(file:File){
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  setBusy(true);setResult(null);
  const timer=setTimeout(()=>abort.abort(),30000);
  try{
   if(file.size>8192)throw new Error('Choose a receipt JSON file smaller than 8 KiB.');
   let receipt:unknown;try{receipt=JSON.parse(await file.text());}catch{throw new Error('This file is not valid JSON. Choose the receipt exported after publication.');}
   const response=await fetch('/api/proofs/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report,receipt}),signal:abort.signal});
   const data=await response.json();
   if(!response.ok)throw new Error(data?.error?.message||'Verification could not complete. Try again.');
   if(!labels[data.status]||typeof data.message!=='string')throw new Error('The verifier returned an unexpected response. Try again.');
   setResult({status:data.status,message:data.message,publisher:data.publisher});
  }catch(error){setResult({status:'unavailable',message:abort.signal.aborted?'Verification timed out. Try uploading the receipt again.':error instanceof Error?error.message:'Verification could not complete.'});}
  finally{clearTimeout(timer);setBusy(false);}
 }
 return <div className="nr-receipt-check">
  <div role="status" aria-live="polite"><p>NEAR receipt: <strong>{busy?'Checking NEAR Testnet…':result?labels[result.status]:'Publication status not checked here.'}</strong></p>
  {result&&<><p>{result.message}</p>{result.publisher&&<p>Expected publisher: <code>{result.publisher}</code></p>}</>}</div>
  <p>Upload the matching receipt to check this report against a finalized NEAR Testnet transaction. This checks publication and report integrity, not measurement accuracy or execution attestation.</p>
  <input ref={input} type="file" accept=".json,application/json" aria-label="Upload NEAR receipt" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void check(file);}}/>
  <button className="vn-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Verifying…':'Upload receipt & verify'}</button>
  <p>No receipt yet? Export the report and follow the publication steps under Evidence and report fingerprints.</p>
 </div>;
}
