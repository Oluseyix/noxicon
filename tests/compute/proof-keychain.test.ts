import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransaction, decodeTransaction, KeyPair, KeyPairSigner } from 'near-api-js';
vi.mock('server-only',()=>({}));
const child=vi.hoisted(()=>({execFile:vi.fn(),end:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:child.execFile}));
import { keychainSigner } from '../../src/lib/server/proof-keychain';
import { publicationSigner } from '../../src/lib/server/proof-config';
import { proofActions } from '../../src/lib/server/proof-near';
import { proofCommitment } from '../../src/lib/server/proof-format';
import { publishProof } from '../../src/lib/server/proof-publication';
import { liveReport, mockChain, publisher } from './proof-helpers';

// Never launches near/security or accesses a real keychain. Keys/RPC are synthetic.
const originalPlatform=process.platform;
let directory:string,binary:string,chain:ReturnType<typeof mockChain>;
let signingOutput:(args:string[])=>Promise<{stdout:string;stderr:string}>;
beforeEach(async()=>{
 Object.defineProperty(process,'platform',{value:'darwin'});
 directory=await mkdtemp(join(tmpdir(),'veyra-keychain-test-'));binary=join(directory,'near');
 await writeFile(binary,Buffer.from('cffaedfe','hex'),{mode:0o700});chain=mockChain();
 vi.stubEnv('VEYRA_PROOF_NETWORK','testnet');vi.stubEnv('NEAR_TESTNET_PUBLISHER',publisher);
 vi.stubEnv('VEYRA_PROOF_PUBLICATION_ENABLED','true');vi.stubEnv('NEAR_TESTNET_SIGNER','keychain');
 vi.stubEnv('NEAR_TESTNET_PUBLIC_KEY',chain.pair.getPublicKey().toString());vi.stubEnv('NEAR_TESTNET_CLI_PATH',binary);
 signingOutput=async args=>{
  const tx=decodeTransaction(Buffer.from(args[4],'base64'));
  const result=await chain.signer.signTransaction(tx);
  return {stdout:'',stderr:`\nSigned transaction (serialized as base64):\n${Buffer.from(result.signedTransaction.encode()).toString('base64')}\n\nThis base64-encoded signed transaction is ready to be sent to the network.\n`};
 };
 child.execFile.mockImplementation((_file:string,args:string[],_options:unknown,callback:(error:Error|null,stdout:string,stderr:string)=>void)=>{
  void (async()=>{
   try{const result=args[0]==='--version'?{stdout:'near-cli-rs 0.31.1\n',stderr:''}:await signingOutput(args);callback(null,result.stdout,result.stderr);}
   catch{callback(new Error('PRIVATE_UPSTREAM_ERROR'),'SECRET_STDOUT','SECRET_STDERR');}
  })();
  return {stdin:{end:child.end}};
 });
});
afterEach(async()=>{
 Object.defineProperty(process,'platform',{value:originalPlatform});
 vi.unstubAllEnvs();vi.clearAllMocks();await rm(directory,{recursive:true,force:true});
});
function fixture(){
 const report=liveReport(),proof=proofCommitment(report);
 const config={publisher,rpcUrl:'https://test.rpc.fastnear.com',verifyRpcUrl:'https://archival-rpc.testnet.near.org',stateDirectory:join(directory,'state')};
 const publish=()=>publishProof(report,proof.commitment,config,{rpc:chain.rpc,verificationRpc:chain.verificationRpc,allowKeychain:true});
 const tx=createTransaction(publisher,chain.pair.getPublicKey(),publisher,5n,proofActions(publisher,KeyPair.fromRandom('ed25519').getPublicKey(),proof.commitment,proof.runId),new Uint8Array(32).fill(7));
 return {report,proof,config,publish,tx};
}

describe('official offline macOS keychain adapter, mocked subprocess only',()=>{
 it('selects the configured public key without reading credentials or running a process',async()=>{
  const signer=publicationSigner({allowKeychain:true});expect((await signer.getPublicKey()).toString()).toBe(chain.pair.getPublicKey().toString());expect(child.execFile).not.toHaveBeenCalled();
 });
 it('preserves explicit opt-in and rejects HTTP/default context, unknown modes and non-macOS',()=>{
  expect(()=>publicationSigner()).toThrow('only through the explicit local proof CLI');
  vi.stubEnv('VEYRA_PROOF_PUBLICATION_ENABLED','false');expect(()=>publicationSigner({allowKeychain:true})).toThrow('disabled');
  vi.stubEnv('VEYRA_PROOF_PUBLICATION_ENABLED','true');vi.stubEnv('NEAR_TESTNET_SIGNER','shell-command');expect(()=>publicationSigner({allowKeychain:true})).toThrow('No automatic fallback');
  vi.stubEnv('NEAR_TESTNET_SIGNER','keychain');Object.defineProperty(process,'platform',{value:'linux'});expect(()=>publicationSigner({allowKeychain:true})).toThrow('only on macOS');
  expect(child.execFile).not.toHaveBeenCalled();
 });
 it.each(['','ed25519:bad','secp256k1:bad'])('rejects invalid public-key configuration %s without a fallback',key=>{
  vi.stubEnv('NEAR_TESTNET_PUBLIC_KEY',key);vi.stubEnv('NEAR_TESTNET_PRIVATE_KEY',chain.pair.toString());
  expect(()=>publicationSigner({allowKeychain:true})).toThrow('exact existing ed25519');expect(child.execFile).not.toHaveBeenCalled();
 });
 it('requires an absolute native executable and the reviewed CLI version',async()=>{
  expect(()=>keychainSigner(publisher,chain.pair.getPublicKey().toString(),'near; unsafe')).toThrow('absolute');
  const f=fixture();await writeFile(binary,'#!/bin/sh\n');await expect(f.publish()).rejects.toThrow('trusted native');expect(child.execFile).not.toHaveBeenCalled();
  await writeFile(binary,Buffer.from('cffaedfe','hex'));
  child.execFile.mockImplementationOnce((_f,_a,_o,cb)=>{cb(null,'near-cli-rs 99.0.0','');return {stdin:{end:child.end}};});
  await expect(f.publish()).rejects.toThrow('reviewed near-cli-rs 0.31.1');expect(chain.call.mock.calls.some(([m])=>m==='send_tx')).toBe(false);
 });
 it('signs only the prepared bytes with fixed offline/display arguments, stripped environment and bounded execution',async()=>{
  vi.stubEnv('NEAR_TESTNET_PRIVATE_KEY','DO_NOT_INHERIT');vi.stubEnv('GROQ_API_KEY','DO_NOT_INHERIT');
  const f=fixture(),result=await f.publish();expect(result.state).toBe('confirmed');
  const [,args,options]=child.execFile.mock.calls[1];
  expect(args).toEqual(['--offline','--quiet','transaction','sign-transaction',expect.any(String),'network-config','testnet','sign-with-keychain','--signer-public-key',chain.pair.getPublicKey().toString(),'--nonce','5','--block-hash',expect.any(String),'--block-height','0','display']);
  expect(args).not.toContain('send');expect(options).toMatchObject({timeout:60000,killSignal:'SIGKILL',maxBuffer:65536});expect(options.shell).toBeUndefined();
  expect(JSON.stringify(options)).not.toContain('DO_NOT_INHERIT');expect(child.end).toHaveBeenCalledTimes(2);
  const query=chain.call.mock.calls.find(([m,p])=>m==='query'&&(p as {request_type:string}).request_type==='view_access_key');expect(query?.[1]).toMatchObject({public_key:chain.pair.getPublicKey().toString(),account_id:publisher,finality:'final'});
 });
 it('rejects a wrong account or public key before invoking the executable',async()=>{
  const f=fixture(),signer=publicationSigner({allowKeychain:true});f.tx.signerId='wrong.testnet';
  await expect(signer.signTransaction(f.tx)).rejects.toThrow('configured publishing account');
  f.tx.signerId=publisher;f.tx.publicKey=KeyPair.fromRandom('ed25519').getPublicKey();await expect(signer.signTransaction(f.tx)).rejects.toThrow('configured publishing account');expect(child.execFile).not.toHaveBeenCalled();
 });
 it('rejects unavailable keychain credentials even if the CLI fallback signs successfully',async()=>{
  const original=signingOutput;signingOutput=async args=>{const output=await original(args);output.stderr='Warning: no access key found in keychain\ntrying with the legacy keychain\n'+output.stderr;return output;};
  await expect(fixture().publish()).rejects.toMatchObject({code:'keychain_unavailable'});expect(chain.call.mock.calls.some(([m])=>m==='send_tx')).toBe(false);
 });
 it('sanitizes signing denial, timeout and process failure and leaves a known not-submitted journal entry',async()=>{
  signingOutput=async()=>{throw new Error('PRIVATE_KEY');};const f=fixture();
  await expect(f.publish()).rejects.toMatchObject({code:'keychain_signing_failed'});
  expect(chain.call.mock.calls.some(([m])=>m==='send_tx')).toBe(false);
  const journal=await readFile(join(f.config.stateDirectory,'journal.json'),'utf8');expect(journal).toContain('not_submitted');expect(journal).not.toMatch(/PRIVATE|SECRET|transactionHash/);
 });
 it.each(['nonce','actions','key','signature','garbage','duplicate-output','trailing-bytes'])('rejects altered CLI %s without broadcasting',async mode=>{
  const original=signingOutput;
  signingOutput=async args=>{
   if(mode==='garbage')return {stdout:'',stderr:'PRIVATE_BAD_OUTPUT'};
   if(mode==='duplicate-output'){const output=await original(args);output.stderr+=output.stderr;return output;}
   const tx=decodeTransaction(Buffer.from(args[4],'base64'));
   if(mode==='nonce')tx.nonce+=1n;if(mode==='actions')tx.actions.pop();
   let signer=chain.signer;
   if(mode==='key'){signer=new KeyPairSigner(KeyPair.fromRandom('ed25519'));tx.publicKey=await signer.getPublicKey();}
   const signed=await signer.signTransaction(tx);if(mode==='signature')signed.signedTransaction.signature.data[0]^=1;
   let bytes=Buffer.from(signed.signedTransaction.encode());if(mode==='trailing-bytes')bytes=Buffer.concat([bytes,Buffer.from([0])]);
   return {stdout:'',stderr:`\nSigned transaction (serialized as base64):\n${bytes.toString('base64')}\n`};
  };
  await expect(fixture().publish()).rejects.toMatchObject({code:'keychain_mismatch'});expect(chain.call.mock.calls.some(([m])=>m==='send_tx')).toBe(false);
 });
 it('preserves approval, FullAccess, durable-before-broadcast, deduplication and independent verification',async()=>{
  const f=fixture();await expect(publishProof(f.report,'0'.repeat(64),f.config,{allowKeychain:true})).rejects.toMatchObject({code:'approval'});expect(child.execFile).not.toHaveBeenCalled();
  chain.control.permission='wrong';await expect(f.publish()).rejects.toMatchObject({code:'key_configuration'});expect(child.execFile).not.toHaveBeenCalled();chain.control.permission='FullAccess';
  const original=chain.call.getMockImplementation()!;chain.call.mockImplementation(async(method,params)=>{
   if(method==='send_tx'){const journal=JSON.parse(await readFile(join(f.config.stateDirectory,'journal.json'),'utf8'));expect(journal.entries[0]).toMatchObject({state:'submitted',transactionHash:expect.any(String)});}
   return original(method,params);
  });
  expect((await f.publish()).state).toBe('confirmed');expect((await f.publish()).duplicate).toBe(true);expect(child.execFile).toHaveBeenCalledTimes(2);
  chain.control.outage=true;const retry=await f.publish();expect(retry.state).toBe('uncertain');expect(retry.receipt).toBeUndefined();expect(child.execFile).toHaveBeenCalledTimes(2);expect(chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
 });
 it('does not sign again after an ambiguous send',async()=>{
  const f=fixture();chain.control.broadcast='before';expect((await f.publish()).state).toBe('uncertain');expect((await f.publish()).state).toBe('uncertain');expect(child.execFile).toHaveBeenCalledTimes(2);expect(chain.call.mock.calls.filter(([m])=>m==='send_tx')).toHaveLength(1);
 });
});
