import 'server-only';
import { ProofError } from './proof-format';
import { TESTNET_RPCS } from './proof-config';

export type ProofRpc={call:(method:string,params:object|unknown[])=>Promise<unknown>};
export function createProofRpc(url:string,request:typeof fetch=fetch,timeoutMs=20000):ProofRpc{
 if(!TESTNET_RPCS.some(allowed=>allowed===url))throw new ProofError('configuration','RPC must be an allowlisted Testnet endpoint.',503);
 return {async call(method,params){
  const signal=AbortSignal.timeout(timeoutMs);
  try{
   // One dispatch, including send_tx. No SDK retries, redirects, or failover.
   const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VeyraProof/1.0'},
    body:JSON.stringify({jsonrpc:'2.0',id:'veyra-proof-v1',method,params}),signal,redirect:'error',cache:'no-store'});
   if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error('http');}
   if(!response.body)throw new Error('body');
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   let data:unknown;
   try{
    signal.throwIfAborted();
    for(;;){const next=await reader.read();signal.throwIfAborted();if(next.done)break;size+=next.value.byteLength;if(size>1048576)throw new Error('size');chunks.push(next.value);}
    data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
   if(!data||typeof data!=='object'||!('result' in data)||'error' in data)throw new Error('rpc');
   return data.result;
  }catch{throw new ProofError('rpc_unavailable',method==='send_tx'?'Testnet RPC did not return a usable response. Submission status may be unknown; do not resubmit blindly.':'The Testnet archive is unavailable. Try verification again shortly.',503);}
 }};
}
export async function assertTestnet(rpc:ProofRpc){
 const status=await rpc.call('status',[]);
 if(!status||typeof status!=='object'||!('chain_id' in status)||status.chain_id!=='testnet')throw new ProofError('wrong_network','RPC did not identify NEAR Testnet.',502);
 if(!('sync_info' in status)||!status.sync_info||typeof status.sync_info!=='object'||!('syncing' in status.sync_info)||status.sync_info.syncing!==false)throw new ProofError('rpc_unavailable','Testnet RPC is not synchronized.',503);
}
