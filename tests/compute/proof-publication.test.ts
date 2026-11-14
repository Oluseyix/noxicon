import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseDecode, baseEncode } from 'near-api-js';
vi.mock('server-only',()=>({}));
import { publishProof } from '../../src/lib/server/proof-publication';
import { proofCommitment, ProofError, makeReceipt } from '../../src/lib/server/proof-format';
import { verifyProof } from '../../src/lib/server/proof-near';
import { proofConfiguration, publicationSigner } from '../../src/lib/server/proof-config';
import { createProofRpc } from '../../src/lib/server/proof-rpc';
import { liveReport, mockChain, publisher, blockHash } from './proof-helpers';

let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'veyra-proof-test-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});vi.unstubAllEnvs();vi.restoreAllMocks();vi.useRealTimers();});
function setup(){
 const chain=mockChain(),report=liveReport(),proof=proofCommitment(report);
 const config={publisher,rpcUrl:'https://test.rpc.fastnear.com',verifyRpcUrl:'https://archival-rpc.testnet.near.org',stateDirectory:directory};
 const signer=vi.fn(()=>chain.signer);
 const publish=()=>publishProof(report,proof.commitment,config,{rpc:chain.rpc,verificationRpc:chain.verificationRpc,signer});
 return {chain,report,proof,config,signer,publish};
}
describe('Testnet publication — SDK-signed synthetic transactions, all RPC mocked',()=>{
 it('publishes exactly two native actions and returns a receipt only after independent final execution confirmation',async()=>{
  const f=setup(),result=await f.publish();expect(result).toMatchObject({state:'confirmed',duplicate:false,receipt:{publisher,network:'testnet',commitment:f.proof.commitment},verification:{verified:true}});
  expect(f.chain.call.mock.calls.filter(([method])=>method==='send_tx')).toHaveLength(1);
  expect(f.chain.read.mock.calls.map(([method])=>method)).toEqual(['status','tx']);
  const journal=await readFile(join(directory,'journal.json'),'utf8');expect(journal).toContain(result.receipt!.transactionHash);expect(journal).not.toContain(f.chain.pair.toString());
  const tx=f.chain.outcome.transaction as {actions:unknown[]};expect(tx.actions).toHaveLength(2);expect(JSON.stringify(tx.actions)).not.toMatch(/prompts|messages|private|apiKey/);
  expect(JSON.stringify(result)).not.toContain(f.chain.pair.toString());
 });
 it('persists the expected transaction hash before broadcasting',async()=>{
  const f=setup(),original=f.chain.call.getMockImplementation()!;
  f.chain.call.mockImplementation(async(method,params)=>{
   if(method==='send_tx'){
    const journal=JSON.parse(await readFile(join(directory,'journal.json'),'utf8'));
    expect(journal.entries[0]).toMatchObject({state:'submitted',commitment:f.proof.commitment});expect(journal.entries[0].transactionHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
   }
   return original(method,params);
  });await f.publish();
 });
 it('deduplicates across service instances and rechecks the chain instead of trusting a saved receipt',async()=>{
  const f=setup(),first=await f.publish(),second=await f.publish();
  expect(second.receipt).toEqual(first.receipt);expect(second.duplicate).toBe(true);expect(f.signer).toHaveBeenCalledOnce();
  expect(f.chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
  f.chain.control.outage=true;const unavailable=await f.publish();expect(unavailable.state).toBe('uncertain');expect(unavailable).not.toHaveProperty('receipt');
 });
 it('never rebroadcasts after an ambiguous submission, even when the RPC cannot find it',async()=>{
  const f=setup();f.chain.control.broadcast='before';
  const first=await f.publish(),second=await f.publish();expect(first.state).toBe('uncertain');expect(second.state).toBe('uncertain');
  expect(first).not.toHaveProperty('receipt');expect(first.expectedTransactionHash).toBe(second.expectedTransactionHash);expect(f.signer).toHaveBeenCalledOnce();
  expect(f.chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
 });
 it('can confirm a lost acknowledgement through independent RPC without another broadcast',async()=>{
  const f=setup();f.chain.control.broadcast='after';expect((await f.publish()).state).toBe('confirmed');expect(f.chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
 });
 it('keeps pending outcomes pending, and later reconciles read-only',async()=>{
  const f=setup();f.chain.control.execution='EXECUTED_OPTIMISTIC';const pending=await f.publish();expect(pending.state).toBe('pending');expect(pending).not.toHaveProperty('receipt');
  f.chain.control.execution='FINAL';const result=await publishProof(f.report,f.proof.commitment,f.config,{verificationRpc:f.chain.verificationRpc,reconcileOnly:true,signer:()=>{throw new Error('Must not sign');}});
  expect(result.state).toBe('confirmed');expect(f.chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
 });
 it('does not sign an unknown report during reconciliation',async()=>{
  const f=setup();await expect(publishProof(f.report,f.proof.commitment,f.config,{reconcileOnly:true,signer:f.signer})).rejects.toMatchObject({code:'no_submission'});expect(f.signer).not.toHaveBeenCalled();
 });
 it('does not claim success or retry after a failed blockchain execution',async()=>{
  const f=setup();f.chain.control.fail=true;const result=await f.publish();expect(result.state).toBe('failed');expect(result).not.toHaveProperty('receipt');await f.publish();expect(f.signer).toHaveBeenCalledOnce();
 });
 it('rejects altered evidence reusing the same run id',async()=>{
  const f=setup();await f.publish();const changed={...f.report,config:{...f.report.config,model:'different/model'}};
  await expect(publishProof(changed,proofCommitment(changed).commitment,f.config)).rejects.toMatchObject({code:'run_conflict'});
 });
 it('rejects missing approval and synthetic reports before RPC/signing',async()=>{
  const f=setup();await expect(publishProof(f.report,'0'.repeat(64),f.config,{signer:f.signer})).rejects.toMatchObject({code:'approval'});
  const synthetic={...f.report,origin:'test-fixture'};await expect(publishProof(synthetic,proofCommitment(synthetic).commitment,f.config,{signer:f.signer})).rejects.toMatchObject({code:'fixture'});expect(f.signer).not.toHaveBeenCalled();
 });
 it.each(['mainnet','key','fee','outage'])('blocks %s during preflight without a transaction submission',async mode=>{
  const f=setup();if(mode==='mainnet')f.chain.control.network='mainnet';if(mode==='key')f.chain.control.permission='wrong';if(mode==='fee')f.chain.control.fee='1000000000000000000';
  if(mode==='outage')f.chain.call.mockRejectedValue(new ProofError('rpc_unavailable','Mock unavailable',503));
  await expect(f.publish()).rejects.toBeInstanceOf(ProofError);expect(f.chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(0);
 });
 it('blocks another run while an earlier submission remains unresolved',async()=>{
  const f=setup();f.chain.control.execution='INCLUDED';await f.publish();
  const next={...f.report,runId:'22222222-2222-4222-8222-222222222222'};
  await expect(publishProof(next,proofCommitment(next).commitment,f.config)).rejects.toMatchObject({code:'unresolved_publication'});
 });
 it('enforces persistent daily spending reservations across process restarts',async()=>{
  const f=setup();for(let i=1;i<=3;i++){
   const report={...f.report,runId:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`};
   await publishProof(report,proofCommitment(report).commitment,f.config,{rpc:f.chain.rpc,verificationRpc:f.chain.verificationRpc,signer:f.signer});
  }
  await expect(f.publish()).rejects.toMatchObject({code:'publication_budget'});expect(f.signer).toHaveBeenCalledTimes(3);
 });
 it('fails closed on a retained crash lock or corrupted ledger',async()=>{
  const f=setup();await mkdir(join(directory,'publication.lock'));
  await expect(f.publish()).rejects.toMatchObject({code:'publication_locked'});await rm(join(directory,'publication.lock'),{recursive:true});
  await writeFile(join(directory,'journal.json'),'{broken',{mode:0o600});await expect(f.publish()).rejects.toMatchObject({code:'invalid_journal'});expect(f.signer).not.toHaveBeenCalled();
 });
 it('serializes concurrent requests with the same durable lock',async()=>{
  const f=setup(),original=f.chain.call.getMockImplementation()!;let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  f.chain.call.mockImplementation(async(method,params)=>{if(method==='status'){entered();await gate;}return original(method,params);});
  const first=f.publish();await started;await expect(f.publish()).rejects.toMatchObject({code:'publication_locked'});release();expect((await first).state).toBe('confirmed');expect(f.signer).toHaveBeenCalledOnce();
 });
 it('allows an explicitly requested retry only after a proven pre-broadcast configuration failure',async()=>{
  const f=setup();f.chain.control.permission='wrong';await expect(f.publish()).rejects.toMatchObject({code:'key_configuration'});
  f.chain.control.permission='FullAccess';expect((await f.publish()).state).toBe('confirmed');expect(f.chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
 });
});

describe('independent on-chain verification — no signing key or local journal required',()=>{
 it.each(['bad-hash','network','publisher','report','missing','commitment','receiver','extra-action','permissions','failed-receipt','pending','rpc'])('rejects or accurately reports %s',async mode=>{
  const f=setup(),result=await f.publish();const receipt=structuredClone(result.receipt!),report=structuredClone(f.report);
  if(mode==='bad-hash')receipt.transactionHash='not-a-hash';
  if(mode==='network')f.chain.control.network='mainnet';
  if(mode==='publisher')receipt.publisher='wrong.testnet';
  if(mode==='report')report.config={...report.config,model:'modified/model'};
  const raw=JSON.parse(JSON.stringify(f.chain.outcome));
  if(mode==='missing')raw.transaction.actions=[];
  if(mode==='commitment')raw.transaction.actions[0].AddKey.access_key.permission.FunctionCall.method_names[1]=`sha256:${'0'.repeat(64)}`;
  if(mode==='receiver')raw.transaction.receiver_id='wrong.testnet';
  if(mode==='extra-action')raw.transaction.actions.push({Transfer:{deposit:'1'}});
  if(mode==='permissions')raw.transaction.actions[0].AddKey.access_key.permission.FunctionCall.allowance=null;
  if(mode==='failed-receipt')raw.receipts_outcome[0].outcome.status={Failure:{mock:true}};
  if(mode==='pending')f.chain.control.execution='INCLUDED';
  if(mode==='rpc')f.chain.control.outage=true;
  f.chain.outcome=raw;
  const verified=await verifyProof(report,receipt,publisher,f.chain.verificationRpc);expect(verified.verified).toBe(false);
  if(mode==='rpc')expect(verified.status).toBe('unavailable');if(mode==='pending')expect(verified.status).toBe('pending');if(mode==='failed-receipt')expect(verified.status).toBe('failed');
 });
 it('does not accept a valid-looking local hash when no on-chain data is available',async()=>{
  const f=setup(),receipt=makeReceipt(f.proof.commitment,f.proof.runId,publisher,blockHash);
  expect((await verifyProof(f.report,receipt,publisher,f.chain.verificationRpc)).verified).toBe(false);
 });
 it('checks a supplied receipt network and actual transaction signer/hash',async()=>{
  const f=setup(),result=await f.publish();expect((await verifyProof(f.report,{...result.receipt,network:'mainnet'},publisher,f.chain.verificationRpc)).verified).toBe(false);
  for(const field of ['signer_id','hash']){
   const raw=JSON.parse(JSON.stringify(f.chain.outcome));raw.transaction[field]=field==='hash'?blockHash:'wrong.testnet';f.chain.outcome=raw;
   expect((await verifyProof(f.report,result.receipt,publisher,f.chain.verificationRpc)).verified).toBe(false);
  }
 });
});

describe('configuration and bounded RPC',()=>{
 it('requires Testnet, an allowlisted named account, known RPCs and explicit signing enablement',()=>{
  vi.stubEnv('VEYRA_PROOF_NETWORK','mainnet');expect(()=>proofConfiguration()).toThrow('Mainnet');
  vi.stubEnv('VEYRA_PROOF_NETWORK','testnet');vi.stubEnv('NEAR_TESTNET_PUBLISHER','wallet.near');expect(()=>proofConfiguration()).toThrow('allowlisted');
  vi.stubEnv('NEAR_TESTNET_PUBLISHER',publisher);vi.stubEnv('NEAR_TESTNET_RPC_URL','https://rpc.mainnet.near.org');expect(()=>proofConfiguration()).toThrow('Testnet RPC');
  vi.stubEnv('VEYRA_PROOF_PUBLICATION_ENABLED','false');expect(()=>publicationSigner()).toThrow('disabled');
 });
 it.each(['','SECRET','ed25519:'+ '1'.repeat(88)])('sanitizes invalid key configuration',secret=>{
  vi.stubEnv('VEYRA_PROOF_PUBLICATION_ENABLED','true');vi.stubEnv('NEAR_TESTNET_PRIVATE_KEY',secret);expect(()=>publicationSigner()).toThrow(ProofError);
 });
 it('accepts an SDK-generated backend key and rejects a corrupted public half without disclosing it',async()=>{
  const chain=mockChain();vi.stubEnv('VEYRA_PROOF_PUBLICATION_ENABLED','true');vi.stubEnv('NEAR_TESTNET_PRIVATE_KEY',chain.pair.toString());
  expect((await publicationSigner().getPublicKey()).toString()).toBe(chain.pair.getPublicKey().toString());
  const bytes=baseDecode(chain.pair.toString().slice(8));bytes[63]^=1;
  vi.stubEnv('NEAR_TESTNET_PRIVATE_KEY',`ed25519:${baseEncode(bytes)}`);
  expect(()=>publicationSigner()).toThrow('The Testnet signing key is invalid. No transaction was submitted.');
 });
 it('sends once, bounds RPC bodies and never returns upstream messages',async()=>{
  for(const response of [new Response('private',{status:503}),Response.json({error:{message:'PRIVATE'}}),new Response('x'.repeat(1048577))]){
   const request=vi.fn<typeof fetch>().mockResolvedValue(response),rpc=createProofRpc('https://test.rpc.fastnear.com',request);
   await expect(rpc.call('send_tx',{signed_tx_base64:'mock-only',wait_until:'NONE'})).rejects.toMatchObject({code:'rpc_unavailable'});expect(request).toHaveBeenCalledOnce();expect(request.mock.calls[0][1]).toMatchObject({redirect:'error',cache:'no-store'});
  }
 });
 it('aborts a stalled RPC body at the deadline without retrying',async()=>{
  const deadline=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal);const cancel=vi.fn();
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({cancel})));
  const rpc=createProofRpc('https://test.rpc.fastnear.com',request);const pending=rpc.call('status',[]);
  await Promise.resolve();await Promise.resolve();deadline.abort();await expect(pending).rejects.toMatchObject({code:'rpc_unavailable'});expect(request).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalled();
 });
});
