import 'server-only';
import { createHash } from 'node:crypto';
import { baseDecode, baseEncode } from 'near-api-js';
import { z } from 'zod';
import { canonicalJson, validateReport } from '../compute/report';

export const PROOF_FORMAT='veyra-benchmark-evidence';
export const PROOF_VERSION=1;
export const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const accountSchema=z.string().min(9).max(64).regex(/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/);
export const transactionHashSchema=z.string().min(32).max(44).refine(value=>{
 try{return baseDecode(value).length===32&&baseEncode(baseDecode(value))===value;}catch{return false;}
},'Expected a canonical base58 32-byte transaction hash');
export class ProofError extends Error {
 constructor(public code:string,message:string,public status=400){super(message);}
}
export function publicationEvidence(value:unknown){
 // Preserve the existing v1/v2 validator, including its aggregate reconciliation.
 const report=validateReport(value);
 const {verification: omittedSummary,requests,...immutable}=report;
 void omittedSummary;
 return {...immutable,requests:requests.map(request=>{
  const {verification: omittedVerification,verificationMs: omittedTiming,...observation}=request;
  void omittedVerification;void omittedTiming;
  return observation;
 })};
}
export function proofCommitment(value:unknown){
 const evidence=publicationEvidence(value);
 const payload={format:PROOF_FORMAT,version:PROOF_VERSION,algorithm:'sha256',evidence};
 const canonical=canonicalJson(payload);
 return {format:PROOF_FORMAT,version:PROOF_VERSION,algorithm:'sha256' as const,
  commitment:createHash('sha256').update(canonical,'utf8').digest('hex'),runId:evidence.runId,canonical};
}
export function proofMethods(commitment:string,runId:string){
 return [`${PROOF_FORMAT}:v${PROOF_VERSION}`,`sha256:${hashSchema.parse(commitment)}`,`run:${z.uuid().parse(runId)}`,'network:testnet'];
}
export const receiptSchema=z.object({
 format:z.literal(PROOF_FORMAT),version:z.literal(PROOF_VERSION),algorithm:z.literal('sha256'),
 commitment:hashSchema,runId:z.uuid(),network:z.literal('testnet'),publisher:accountSchema,
 transactionHash:transactionHashSchema,explorerUrl:z.string().max(200),
}).strict();
export type PublicationReceipt=z.infer<typeof receiptSchema>;
export function explorerUrl(transactionHash:string){return `https://testnet.nearblocks.io/txns/${transactionHashSchema.parse(transactionHash)}`;}
export function makeReceipt(commitment:string,runId:string,publisher:string,transactionHash:string):PublicationReceipt{
 return receiptSchema.parse({format:PROOF_FORMAT,version:PROOF_VERSION,algorithm:'sha256',commitment,runId,network:'testnet',publisher,transactionHash,explorerUrl:explorerUrl(transactionHash)});
}
