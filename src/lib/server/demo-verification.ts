import 'server-only';
import report from '../../../evidence/groq-report.json';
import receipt from '../../../evidence/near-testnet-receipt.json';
import { verifyProof,type ProofVerification } from './proof-near';
import { createProofRpc } from './proof-rpc';

// Public, fixed historical demonstration only. No input report, URL, account,
// environment configuration, key, journal or publication function is accepted.
export function createDemoVerification(check:()=>Promise<ProofVerification>=()=>verifyProof(report,receipt,'veyra-proof.testnet',createProofRpc('https://archival-rpc.testnet.near.org')),now:()=>number=Date.now){
 let busy=false,start=now(),count=0;
 return async function POST(request:Request){
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const url=new URL(request.url);
  // Next may canonicalize request.url to localhost behind its HTTP adapter.
  // Compare the browser origin with the actual Host, not a proxy/internal name.
  let sameHost=false;
  try{const origin=new URL(request.headers.get('origin')??'');sameHost=['http:','https:'].includes(origin.protocol)&&origin.host===(request.headers.get('host')??url.host);}catch{}
  if(!sameHost||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Same-origin requests only.'},403);
  const invalidInput=()=>reply({error:'This endpoint accepts no input; only the bundled historical report can be checked.'},400);
  if(url.search)return invalidInput();
  // Next represents even a zero-byte POST as a stream. Permit EOF, never data.
  if(request.body){
   const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const first=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('body_timeout')),2000);})]);
    if(!first.done)return invalidInput();
   }catch{return invalidInput();}
   finally{if(timer)clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  if(now()-start>=60000){start=now();count=0;}
  if(busy||count>=4)return reply({error:'Verification is busy or rate limited. Try again later; no automatic retry is made.'},429);
  count++;busy=true;
  try{return reply({result:await check(),checkedAt:new Date(now()).toISOString(),transactionHash:receipt.transactionHash,publisher:'veyra-proof.testnet',network:'testnet'});}
  catch{return reply({error:'Public Testnet RPC is unavailable. No verification claim was made.'},503);}
  finally{busy=false;}
 };
}
