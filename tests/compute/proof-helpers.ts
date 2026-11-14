// Entirely synthetic reports, keys, RPC outcomes and hashes for offline tests.
import { createHash } from 'node:crypto';
import { baseEncode, decodeSignedTransaction, encodeTransaction, KeyPair, KeyPairSigner, PublicKey } from 'near-api-js';
import { vi } from 'vitest';
import { uiFixture } from './ui-fixture';
import { mapVerification } from '../../src/lib/compute/verification';
import { statistics, verificationSummary } from '../../src/lib/compute/metrics';
import { ProofError } from '../../src/lib/server/proof-format';
import type { ProofRpc } from '../../src/lib/server/proof-rpc';

export const publisher='veyra-mock.testnet';
export const blockHash=baseEncode(new Uint8Array(32).fill(7));
export function liveReport(version:1|2=2){
 const report=uiFixture();report.origin='live';report.schemaVersion=version;
 if(version===2)report.config={...report.config,provider:'groq',model:'llama-3.3-70b-versatile'};
 for(const request of report.requests){request.verification=mapVerification();request.verificationMs=null;}
 report.statistics=statistics(report.requests);report.verification=verificationSummary(report.requests);
 return report;
}
export function mockChain(){
 const pair=KeyPair.fromRandom('ed25519'),signer=new KeyPairSigner(pair);
 let outcome:Record<string,unknown>|undefined;
 const control={network:'testnet',permission:'FullAccess',fee:'100000000',execution:'FINAL',fail:false,outage:false,broadcast:'ok' as 'ok'|'before'|'after'};
 const status=()=>({chain_id:control.network,sync_info:{syncing:false}});
 const cost={send_sir:1000000,send_not_sir:2000000,execution:3000000};
 const call=vi.fn<ProofRpc['call']>().mockImplementation(async(method,params)=>{
  if(method==='status')return status();
  if(method==='query'){
   const p=params as {request_type:string};
   return p.request_type==='view_access_key'?{nonce:4,permission:control.permission,block_hash:blockHash}:{amount:'1000000000000000000000000',locked:'0',code_hash:'11111111111111111111111111111111'};
  }
  if(method==='EXPERIMENTAL_protocol_config')return {runtime_config:{transaction_costs:{action_receipt_creation_config:cost,action_creation_config:{add_key_cost:{function_call_cost:cost,function_call_cost_per_byte:cost},delete_key_cost:cost}}}};
  if(method==='gas_price')return {gas_price:control.fee};
  if(method==='send_tx'){
   if(control.broadcast==='before')throw new ProofError('rpc_unavailable','Mock RPC unavailable',503);
   const bytes=Buffer.from((params as {signed_tx_base64:string}).signed_tx_base64,'base64');
   const signed=decodeSignedTransaction(bytes),tx=signed.transaction,a=tx.actions[0].addKey!,d=tx.actions[1].deleteKey!,p=a.accessKey.permission.functionCall!;
   const hash=baseEncode(createHash('sha256').update(encodeTransaction(tx)).digest());
   outcome={transaction:{hash,signer_id:tx.signerId,receiver_id:tx.receiverId,public_key:tx.publicKey.toString(),nonce:Number(tx.nonce),
    signature:`ed25519:${baseEncode(signed.signature.data)}`,
    actions:[{AddKey:{public_key:PublicKey.from(a.publicKey).toString(),access_key:{nonce:Number(a.accessKey.nonce),permission:{FunctionCall:{allowance:p.allowance!.toString(),receiver_id:p.receiverId,method_names:p.methodNames}}}}},{DeleteKey:{public_key:PublicKey.from(d.publicKey).toString()}}]},
    transaction_outcome:{outcome:{status:{SuccessReceiptId:blockHash}}},receipts_outcome:[{outcome:{status:{SuccessValue:''}}}]};
   if(control.broadcast==='after')throw new ProofError('rpc_unavailable','Mock lost acknowledgement',503);
   return {final_execution_status:'NONE'};
  }
  throw new Error('Unexpected mock method');
 });
 const read=vi.fn<ProofRpc['call']>().mockImplementation(async method=>{
  if(control.outage)throw new ProofError('rpc_unavailable','Mock RPC unavailable',503);
  if(method==='status')return status();
  if(method!=='tx'||!outcome)throw new ProofError('rpc_unavailable','Mock transaction unavailable',503);
  return {...outcome,final_execution_status:control.execution,status:control.fail?{Failure:{ActionError:'mock failure'}}:{SuccessValue:''}};
 });
 return {signer,pair,control,rpc:{call},verificationRpc:{call:read},call,read,
  get outcome(){return outcome!;},set outcome(value:Record<string,unknown>){outcome=value;}};
}
