import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { assertBenchmarkOrigin, BoundaryError } from './compute-http';
import { ProofError } from './proof-format';

let windowStart=Date.now(),requests=0;
export function authorizeProofRequest(request:Request){
 assertBenchmarkOrigin(request);
 const url=new URL(request.url);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))
  throw new ProofError('origin','Proof publication is limited to local operator environments.',403);
 const token=process.env.VEYRA_PROOF_API_TOKEN;
 if(!token||!/^[a-f0-9]{64}$/.test(token))throw new ProofError('authentication_unconfigured','Configure a private 32-byte hex publication API token.',503);
 const authorization=request.headers.get('authorization')??'';
 if(!/^Bearer [a-f0-9]{64}$/.test(authorization)||!timingSafeEqual(Buffer.from(authorization),Buffer.from(`Bearer ${token}`)))throw new ProofError('unauthorized','Publication authorization is required.',401);
 if(Date.now()-windowStart>=60000){windowStart=Date.now();requests=0;}
 if(++requests>12)throw new ProofError('request_limit','At most twelve authorized proof requests per minute are accepted.',429);
}
export async function readProofInput(request:Request):Promise<unknown>{
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new ProofError('content_type','Expected application/json.',415);
 const reader=request.body?.getReader();if(!reader)throw new ProofError('body','Missing proof request.');
 let timer:ReturnType<typeof setTimeout>|undefined;
 const read=async()=>{
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>270336)throw new ProofError('body_limit','Proof requests must be smaller than 264 KiB.',413);chunks.push(value);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ProofError('invalid_json','Invalid JSON proof request.');}
 };
 try{return await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new ProofError('body_timeout','Proof request body timed out.',408));},5000);})]);}
 finally{if(timer)clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function proofResponse(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function proofFailure(error:unknown){
 if(error instanceof ProofError)return proofResponse({error:{code:error.code,message:error.message}},error.status);
 if(error instanceof BoundaryError)return proofResponse({error:{code:'origin',message:error.message}},error.status);
 return proofResponse({error:{code:'invalid_or_unavailable',message:'Proof request could not complete. Check the input and local journal before any new submission.'}},400);
}
