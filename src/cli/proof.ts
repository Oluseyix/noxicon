import { access, readFile, lstat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { proofCommitment, ProofError } from '../lib/server/proof-format';
import { proofConfiguration } from '../lib/server/proof-config';
import { publishProof } from '../lib/server/proof-publication';
import { verifyProof } from '../lib/server/proof-near';
import { createProofRpc } from '../lib/server/proof-rpc';

async function jsonFile(path:string|undefined){
 if(!path)throw new ProofError('arguments','An input file is required.');
 const info=await lstat(path);
 if(!info.isFile()||info.size>262144)throw new ProofError('file','Input must be a regular JSON file no larger than 256 KiB.');
 return JSON.parse(await readFile(path,'utf8')) as unknown;
}
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(!['preview','publish','verify','reconcile'].includes(command)||args.length%2)throw new ProofError('arguments','Usage: npm run proof -- preview|publish|verify|reconcile --report FILE [--approve SHA256] [--receipt FILE]');
 const options=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){
  if(!['--report','--approve','--receipt'].includes(args[i])||options.has(args[i])||!args[i+1])throw new ProofError('arguments','Unknown, repeated or missing command option.');
  options.set(args[i],args[i+1]);
 }
 const report=await jsonFile(options.get('--report'));
 const proof=proofCommitment(report);
 if(command==='preview'){
  if(options.size!==1)throw new ProofError('arguments','Preview accepts only --report.');
  // Offline; no key, RPC or publication metadata is needed.
  const {canonical: omitted,...summary}=proof;void omitted;
  console.log(JSON.stringify({...summary,onChainFields:['format/version','sha256 commitment','run identifier','testnet'],submitted:false},null,2));return;
 }
 const config=proofConfiguration();
 if(command==='verify'){
  if(options.has('--approve'))throw new ProofError('arguments','Verification never accepts transaction approval.');
  const result=await verifyProof(report,await jsonFile(options.get('--receipt')),config.publisher,createProofRpc(config.verifyRpcUrl));
  console.log(JSON.stringify(result,null,2));if(!result.verified)process.exitCode=2;return;
 }
 const receiptPath=options.get('--receipt');
 if(!receiptPath)throw new ProofError('arguments','--receipt must name a new output file.');
 await access(dirname(receiptPath),constants.W_OK);
 try{await lstat(receiptPath);throw new ProofError('output_exists','Receipt output already exists. Use verify on it; do not overwrite it.');}
 catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;}
 if(command==='publish'&&!options.has('--approve'))throw new ProofError('approval','Run preview first, then explicitly pass --approve with that exact commitment.');
 if(command==='reconcile'&&options.has('--approve'))throw new ProofError('arguments','Reconciliation does not accept signing approval.');
 const result=await publishProof(report,command==='reconcile'?proof.commitment:options.get('--approve')!,config,{reconcileOnly:command==='reconcile',allowKeychain:true});
 if(result.state==='confirmed'&&result.receipt)await writeFile(receiptPath,JSON.stringify(result.receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result,null,2));if(result.state!=='confirmed')process.exitCode=2;
}
void main().catch(error=>{
 console.error(JSON.stringify({error:error instanceof ProofError?{code:error.code,message:error.message}:{code:'invalid_or_unavailable',message:'Command could not complete. Check input files, configuration and the publication journal. No private error details were printed.'}}));
 process.exitCode=1;
});
