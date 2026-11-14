import 'server-only';
import { actions, baseDecode, baseEncode, createTransaction, KeyPair, PublicKey } from 'near-api-js';
import { z } from 'zod';
import { canonicalJson } from '../compute/report';
import { accountSchema, explorerUrl, makeReceipt, proofCommitment, proofMethods, ProofError, receiptSchema, transactionHashSchema } from './proof-format';
import { assertTestnet, type ProofRpc } from './proof-rpc';
import type { ProofSigner } from './proof-keychain';

const integer=z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),z.string().regex(/^\d{1,20}$/)]).transform(v=>BigInt(v));
const publicKey=z.string().max(52).regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/).refine(value=>{try{return PublicKey.fromString(value).data.length===32;}catch{return false;}});
const fee=z.object({send_sir:integer,send_not_sir:integer,execution:integer});
const protocolSchema=z.object({runtime_config:z.object({transaction_costs:z.object({
 action_receipt_creation_config:fee,
 action_creation_config:z.object({add_key_cost:z.object({function_call_cost:fee,function_call_cost_per_byte:fee}),delete_key_cost:fee}),
})})});
export const MAX_PUBLICATION_FEE_YOCTO=10n**22n; // 0.01 Testnet NEAR preflight ceiling.
export function proofActions(publisher:string,ephemeral:PublicKey,commitment:string,runId:string){
 return [actions.addFunctionCallAccessKey(ephemeral,publisher,proofMethods(commitment,runId),0n),actions.deleteKey(ephemeral)];
}
export async function prepareProofTransaction(rpc:ProofRpc,signer:ProofSigner,publisher:string,commitment:string,runId:string){
 accountSchema.parse(publisher);
 await assertTestnet(rpc);
 const signingKey=await signer.getPublicKey();
 const key=z.object({nonce:integer,permission:z.literal('FullAccess'),block_hash:transactionHashSchema}).safeParse(
  await rpc.call('query',{request_type:'view_access_key',finality:'final',account_id:publisher,public_key:signingKey.toString()}));
 if(!key.success)throw new ProofError('key_configuration','The configured key must be an existing FullAccess key on the allowlisted Testnet account.',503);
 const account=z.object({amount:z.string().regex(/^\d+$/),locked:z.literal('0'),code_hash:z.literal('11111111111111111111111111111111')}).safeParse(
  await rpc.call('query',{request_type:'view_account',finality:'final',account_id:publisher}));
 if(!account.success)throw new ProofError('account_configuration','Use a dedicated, unstaked Testnet account with no deployed contract.',503);
 // Bound the native action fees using the current protocol costs, with margin.
 const protocol=protocolSchema.safeParse(await rpc.call('EXPERIMENTAL_protocol_config',{finality:'final'}));
 const gas=z.object({gas_price:z.string().regex(/^\d+$/)}).safeParse(await rpc.call('gas_price',[null]));
 if(!protocol.success||!gas.success)throw new ProofError('fee_unavailable','Cannot establish a bounded Testnet transaction fee.',503);
 const costs=protocol.data.runtime_config.transaction_costs;
 const total=(f:z.infer<typeof fee>)=>(f.send_sir>f.send_not_sir?f.send_sir:f.send_not_sir)+f.execution;
 const bytes=BigInt(proofMethods(commitment,runId).reduce((n,s)=>n+Buffer.byteLength(s)+1,0));
 const gasBound=total(costs.action_receipt_creation_config)+total(costs.action_creation_config.add_key_cost.function_call_cost)+
  bytes*total(costs.action_creation_config.add_key_cost.function_call_cost_per_byte)+total(costs.action_creation_config.delete_key_cost);
 const feeBound=gasBound*BigInt(gas.data.gas_price)*4n;
 if(feeBound<=0n||feeBound>MAX_PUBLICATION_FEE_YOCTO)throw new ProofError('fee_limit','The estimated Testnet fee exceeds the publication ceiling.',503);
 if(BigInt(account.data.amount)<feeBound+10n**23n)throw new ProofError('balance','The dedicated Testnet account needs at least the estimated fee plus 0.1 Testnet NEAR reserve.',503);
 const ephemeral=KeyPair.fromRandom('ed25519').getPublicKey();
 if(ephemeral.toString()===signingKey.toString())throw new ProofError('key_configuration','Temporary key collision; no transaction submitted.',503);
 const transaction=createTransaction(publisher,signingKey,publisher,key.data.nonce+1n,proofActions(publisher,ephemeral,commitment,runId),baseDecode(key.data.block_hash));
 // SDK signs locally; deliberately do not use Account.signAndSendTransaction,
 // whose nonce/retry behavior could obscure ambiguous submission outcomes.
 const signed=await signer.signTransaction(transaction);
 return {transactionHash:baseEncode(signed.txHash),signedBase64:Buffer.from(signed.signedTransaction.encode()).toString('base64'),feeBoundYocto:feeBound.toString()};
}

const permission=z.object({FunctionCall:z.object({allowance:z.literal('0'),receiver_id:accountSchema,method_names:z.array(z.string().max(100)).length(4)}).strict()}).strict();
const add=z.object({AddKey:z.object({public_key:publicKey,access_key:z.object({nonce:integer,permission}).strict()}).strict()}).strict();
const remove=z.object({DeleteKey:z.object({public_key:publicKey}).strict()}).strict();
const transactionSchema=z.object({hash:transactionHashSchema,signer_id:accountSchema,receiver_id:accountSchema,public_key:publicKey,nonce:integer,
 actions:z.tuple([add,remove])});
const outcome=z.object({outcome:z.object({status:z.unknown()})});
const resultSchema=z.object({final_execution_status:z.string(),status:z.unknown(),transaction:z.unknown(),
 transaction_outcome:outcome,receipts_outcome:z.array(outcome).min(1).max(20)});
export type ProofVerification={verified:boolean;status:'verified'|'mismatch'|'failed'|'pending'|'unavailable'|'invalid';code:string;message:string};
const verdict=(status:ProofVerification['status'],code:string,message:string):ProofVerification=>({verified:status==='verified',status,code,message});
const has=(v:unknown,key:string)=>!!v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,key);
const successValue=(v:unknown)=>has(v,'SuccessValue')&&typeof (v as {SuccessValue:unknown}).SuccessValue==='string';
const successReceipt=(v:unknown)=>has(v,'SuccessReceiptId')&&transactionHashSchema.safeParse((v as {SuccessReceiptId:unknown}).SuccessReceiptId).success;
export async function verifyProof(report:unknown,receiptValue:unknown,expectedPublisher:string,rpc:ProofRpc):Promise<ProofVerification>{
 try{
  accountSchema.parse(expectedPublisher);
  const receipt=receiptSchema.safeParse(receiptValue);
  if(!receipt.success)return verdict('invalid','invalid_receipt','Receipt format, network, account or transaction hash is invalid.');
  if(receipt.data.publisher!==expectedPublisher)return verdict('mismatch','wrong_publisher','Receipt publisher differs from the independently configured expected account.');
  if(receipt.data.explorerUrl!==explorerUrl(receipt.data.transactionHash))return verdict('invalid','invalid_explorer','Receipt explorer URL is not the expected Testnet URL.');
  const evidence=proofCommitment(report);
  if(evidence.commitment!==receipt.data.commitment||evidence.runId!==receipt.data.runId)return verdict('mismatch','report_mismatch','Report evidence does not match the receipt commitment or run identifier.');
  await assertTestnet(rpc);
  const raw=await rpc.call('tx',{tx_hash:receipt.data.transactionHash,sender_account_id:expectedPublisher,wait_until:'FINAL'});
  if(!raw||typeof raw!=='object')return verdict('unavailable','invalid_rpc','RPC returned no transaction result.');
  if('final_execution_status' in raw&&raw.final_execution_status!=='FINAL')return verdict('pending','not_final','Transaction execution is not final.');
  const result=resultSchema.safeParse(raw);
  if(!result.success)return verdict('unavailable','incomplete_rpc','RPC did not return complete transaction and execution evidence.');
  const statuses=[result.data.status,result.data.transaction_outcome.outcome.status,...result.data.receipts_outcome.map(r=>r.outcome.status)];
  if(statuses.some(s=>has(s,'Failure')))return verdict('failed','transaction_failed','The transaction or an execution receipt failed.');
  if(!successValue(result.data.status)||statuses.some(s=>!successValue(s)&&!successReceipt(s)))return verdict('unavailable','execution_unknown','Successful execution could not be established.');
  const tx=transactionSchema.safeParse(result.data.transaction);
  if(!tx.success)return verdict('mismatch','missing_record','The transaction is not a Veyra native-action commitment record.');
  const t=tx.data,a=t.actions[0].AddKey,d=t.actions[1].DeleteKey,p=a.access_key.permission.FunctionCall;
  if(t.hash!==receipt.data.transactionHash||t.signer_id!==expectedPublisher||t.receiver_id!==expectedPublisher||p.receiver_id!==expectedPublisher)return verdict('mismatch','wrong_publisher','Transaction hash, signer or receiver differs from the expected publication.');
  if(a.public_key!==d.public_key||a.public_key===t.public_key||a.access_key.nonce!==0n||canonicalJson(p.method_names)!==canonicalJson(proofMethods(evidence.commitment,evidence.runId)))return verdict('mismatch','record_mismatch','On-chain commitment data or action permissions do not match the report.');
  // NEAR's SignedTransactionView omits the reference block hash, so it cannot
  // reproduce the signed Borsh transaction. Trust is in the independent RPC's
  // finalized chain data, not in the local receipt or an invented inclusion proof.
  return verdict('verified','commitment_verified','The report commitment matches a successful, finalized Testnet transaction from the expected publisher. This does not verify GPU execution or TEE attestation.');
 }catch(error){
  if(error instanceof ProofError)return verdict(error.code==='wrong_network'?'mismatch':'unavailable',error.code,error.message);
  return verdict('invalid','invalid_evidence','The report or RPC data is invalid. No verification claim was made.');
 }
}
export { makeReceipt };
