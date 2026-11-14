import 'server-only';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { baseEncode, decodeSignedTransaction, encodeTransaction, PublicKey, type KeyPairSigner } from 'near-api-js';
import { accountSchema, ProofError } from './proof-format';

export type ProofSigner=Pick<KeyPairSigner,'getPublicKey'|'signTransaction'>;
const CLI_VERSION='near-cli-rs 0.31.1';
type Output={stdout:string;stderr:string};

// No shell, inherited secrets, terminal output, stdin prompts or automatic retry.
// Invoke the native executable, not the npm wrapper (which spawns another process).
function runCli(executable:string,args:string[],timeout:number):Promise<Output>{
 return new Promise((resolve,reject)=>{
  const child=execFile(executable,args,{encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:65536,
   env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin',LANG:'C',NO_COLOR:'1',TMPDIR:process.env.TMPDIR},
  },(error,stdout,stderr)=>{
   if(error)reject(new ProofError('keychain_signing_failed','NEAR keychain signing failed or timed out. Unlock the login keychain and check the configured credential. No transaction was submitted.',503));
   else resolve({stdout,stderr});
  });
  child.stdin?.end();
 });
}

async function nativeExecutable(path:string){
 try{
  const resolved=await realpath(path),info=await stat(resolved);
  if(!info.isFile()||(info.mode&0o022)!==0||(info.mode&0o111)===0)throw new Error('permissions');
  const file=await open(resolved,'r'),magic=Buffer.alloc(4);
  try{await file.read(magic,0,4,0);}finally{await file.close();}
  // Mach-O 64-bit or universal binary. Never execute a shell/Node wrapper.
  if(!['cffaedfe','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic.toString('hex')))throw new Error('binary');
  return resolved;
 }catch{throw new ProofError('keychain_configuration','NEAR_TESTNET_CLI_PATH must name the trusted native near-cli-rs executable, with no group/world write permission.',503);}
}

export function keychainSigner(publisher:string,publicKeyValue:string|undefined,executable:string|undefined):ProofSigner{
 if(process.platform!=='darwin')throw new ProofError('keychain_configuration','macOS keychain signing is supported only on macOS.',503);
 accountSchema.parse(publisher);
 let publicKey:PublicKey;
 try{
  if(!publicKeyValue||!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKeyValue))throw new Error('key');
  publicKey=PublicKey.fromString(publicKeyValue);
  if(publicKey.data.length!==32||publicKey.toString()!==publicKeyValue)throw new Error('key');
 }catch{throw new ProofError('keychain_configuration','Set NEAR_TESTNET_PUBLIC_KEY to the exact existing ed25519 FullAccess public key.',503);}
 if(!executable||!isAbsolute(executable)||executable.includes('\0'))throw new ProofError('keychain_configuration','Set NEAR_TESTNET_CLI_PATH to the absolute native near-cli-rs executable path.',503);
 return {
  async getPublicKey(){return publicKey;},
  async signTransaction(transaction){
   if(transaction.signerId!==publisher||transaction.receiverId!==publisher||transaction.publicKey.toString()!==publicKeyValue)
    throw new ProofError('keychain_mismatch','The transaction does not match the configured publishing account and public key.',503);
   const binary=await nativeExecutable(executable);
   const version=await runCli(binary,['--version'],5000);
   if(version.stdout.trim()!==CLI_VERSION)throw new ProofError('keychain_configuration','Keychain signing requires the reviewed near-cli-rs 0.31.1 interface.',503);
   const unsigned=Buffer.from(encodeTransaction(transaction));
   const output=await runCli(binary,['--offline','--quiet','transaction','sign-transaction',unsigned.toString('base64'),
    'network-config','testnet','sign-with-keychain','--signer-public-key',publicKeyValue,
    '--nonce',transaction.nonce.toString(),'--block-hash',baseEncode(transaction.blockHash),
    // Required by CLI offline parsing, unused for ordinary transactions. Returned
    // bytes must match the ordinary transaction; delegate actions are rejected.
    '--block-height','0','display'],60000);
   // Reviewed CLI emits this warning unconditionally if keychain lookup fails.
   // Never accept its automatic legacy-file fallback, even if signing succeeded.
   if(/legacy keychain/i.test(output.stdout+output.stderr))throw new ProofError('keychain_unavailable','The macOS credential was unavailable. Legacy credential fallback is rejected; no transaction was submitted.',503);
   try{
    const matches=[...output.stderr.matchAll(/^Signed transaction \(serialized as base64\):\r?\n([A-Za-z0-9+/]+={0,2})\r?$/gm)];
    if(matches.length!==1)throw new Error('output');
    const encoded=matches[0][1],bytes=Buffer.from(encoded,'base64');
    if(bytes.toString('base64')!==encoded)throw new Error('encoding');
    const signedTransaction=decodeSignedTransaction(bytes);
    const txHash=createHash('sha256').update(unsigned).digest();
    if(!unsigned.equals(Buffer.from(encodeTransaction(signedTransaction.transaction)))||
       !bytes.equals(Buffer.from(signedTransaction.encode()))||signedTransaction.signature.signatureType!==0||
       !publicKey.verify(txHash,signedTransaction.signature.data))throw new Error('mismatch');
    return {txHash,signedTransaction};
   }catch{throw new ProofError('keychain_mismatch','The CLI did not return a valid signature for the exact approved transaction and public key. No transaction was submitted.',503);}
  },
 };
}
