import { lstat, readFile } from 'node:fs/promises';
import { compareProofEvidence } from '../lib/server/proof-compare';

// Offline inspection only. No environment loading, RPC, signing or journal.
async function readReport(path:string){
 const info=await lstat(path);
 if(!info.isFile()||info.size>262144)throw new Error('file');
 return JSON.parse(await readFile(path,'utf8')) as unknown;
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==2)throw new Error('arguments');
 const result=compareProofEvidence(await readReport(args[0]),await readReport(args[1]));
 console.log(JSON.stringify(result,null,2));
 if(!result.sameCommitment)process.exitCode=2;
}
void main().catch(()=>{
 console.error('Provide two valid benchmark reports, each at most 256 KiB. Usage: npm run proof:compare -- BEFORE.json AFTER.json');
 process.exitCode=1;
});
