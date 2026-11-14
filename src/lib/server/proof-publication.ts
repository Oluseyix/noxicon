import 'server-only';
import { validateReport } from '../compute/report';
import { proofCommitment, hashSchema, ProofError, type PublicationReceipt } from './proof-format';
import { publicationSigner, type ProofConfiguration } from './proof-config';
import { createProofRpc, type ProofRpc } from './proof-rpc';
import { makeReceipt, prepareProofTransaction, verifyProof, type ProofVerification } from './proof-near';
import { ProofStore } from './proof-store';

export type PublicationResult={state:'confirmed'|'failed'|'pending'|'uncertain'|'not_submitted';receipt?:PublicationReceipt;
 expectedTransactionHash?:string;verification?:ProofVerification;duplicate:boolean};
export async function publishProof(reportValue:unknown,approval:string,config:ProofConfiguration,dependencies:{
 rpc?:ProofRpc;verificationRpc?:ProofRpc;signer?:typeof publicationSigner;now?:()=>number;reconcileOnly?:boolean;allowKeychain?:boolean;
}={}):Promise<PublicationResult>{
 const report=validateReport(reportValue),proof=proofCommitment(report);
 if(report.origin!=='live')throw new ProofError('fixture','Synthetic/test-fixture reports cannot be published.');
 if(!hashSchema.safeParse(approval).success||approval!==proof.commitment)throw new ProofError('approval','Explicit approval must exactly match the locally calculated evidence commitment.',403);
 const rpc=dependencies.rpc??createProofRpc(config.rpcUrl),verificationRpc=dependencies.verificationRpc??createProofRpc(config.verifyRpcUrl);
 const store=new ProofStore(config.stateDirectory),now=dependencies.now??Date.now;
 return store.locked(async(journal,save)=>{
  let entry=journal.entries.find(e=>e.publisher===config.publisher&&e.runId===proof.runId);
  const duplicate=!!entry;
  if(entry&&entry.commitment!==proof.commitment)throw new ProofError('run_conflict','This run identifier already has different committed evidence. No new transaction was signed.',409);
  if(entry&&!entry.transactionHash&&(entry.state!=='not_submitted'||dependencies.reconcileOnly))return {state:'not_submitted',duplicate:true};
  if(!entry||entry.state==='not_submitted'){
   if(dependencies.reconcileOnly)throw new ProofError('no_submission','No prior publication exists for this report. Reconciliation never signs or submits.',404);
   if(journal.entries.some(e=>e.state==='reserved'||e.state==='submitted'))throw new ProofError('unresolved_publication','An unresolved publication must be reconciled before another transaction can be signed.',409);
   if(journal.entries.filter(e=>e!==entry&&e.createdAt>now()-86400000).length>=3)throw new ProofError('publication_budget','Publication budget reached: three reservations per 24 hours.',429);
   if(!entry){
    if(journal.entries.length>=20)throw new ProofError('publication_budget','Publication budget reached: twenty total reservations per journal.',429);
    entry={publisher:config.publisher,runId:proof.runId,commitment:proof.commitment,createdAt:now(),state:'reserved'};
    journal.entries.push(entry);
   }else {entry.state='reserved';entry.createdAt=now();}
   await save();
   let prepared;
   try{prepared=await prepareProofTransaction(rpc,dependencies.signer?dependencies.signer():publicationSigner({allowKeychain:dependencies.allowKeychain}),config.publisher,proof.commitment,proof.runId);}
   catch(error){entry.state='not_submitted';await save();if(error instanceof ProofError)throw error;throw new ProofError('preparation_failed','Transaction preparation failed before submission. No private error details were retained.',503);}
   entry.transactionHash=prepared.transactionHash;entry.state='submitted';
   // Durable intent/hash MUST precede the only broadcast. A crash anywhere after
   // this write is reconciled by hash; neither the nonce nor the tx is regenerated.
   await save();
   try{await rpc.call('send_tx',{signed_tx_base64:prepared.signedBase64,wait_until:'NONE'});}catch{/* Ambiguous: query independently, never broadcast again. */}
  }
  const candidate=makeReceipt(proof.commitment,proof.runId,config.publisher,entry.transactionHash!);
  const verification=await verifyProof(report,candidate,config.publisher,verificationRpc);
  if(verification.verified){entry.state='confirmed';entry.receipt=candidate;await save();return {state:'confirmed',receipt:candidate,verification,duplicate};}
  // A candidate receipt never leaves this function unless execution was confirmed.
  if(verification.status==='failed'){entry.state='failed';delete entry.receipt;await save();return {state:'failed',expectedTransactionHash:entry.transactionHash,verification,duplicate};}
  return {state:verification.status==='pending'?'pending':'uncertain',expectedTransactionHash:entry.transactionHash,verification,duplicate};
 });
}
