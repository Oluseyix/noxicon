import { lstat, readFile } from 'node:fs/promises';
import { verifyProof } from '../lib/server/proof-near';
import { createProofRpc } from '../lib/server/proof-rpc';

// Read-only judge entry point: no .env loading, signer, journal or publication.
// Trust the publisher independently of the supplied report/receipt.
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==0&&(args.length!==2||args[0]!=='--report'))throw new Error('arguments');
 const reportPath=args[1]??new URL('../../evidence/groq-report.json',import.meta.url);
 const info=await lstat(reportPath);
 if(!info.isFile()||info.size>262144)throw new Error('report');
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 const receipt=JSON.parse(await readFile(new URL('../../evidence/near-testnet-receipt.json',import.meta.url),'utf8'));
 const result=await verifyProof(report,receipt,'veyra-proof.testnet',createProofRpc('https://archival-rpc.testnet.near.org'));
 console.log(JSON.stringify(result,null,2));
 if(!result.verified)process.exitCode=2;
}
void main().catch(()=>{
 console.error('Cannot read verification input. Usage: npm run verify:demo -- [--report REPORT.json]');
 process.exitCode=1;
});
