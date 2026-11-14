// Standalone reference implementation: Node built-ins only, no app imports,
// credentials, RPC, receipt or journal. Use an already validated exported report.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 throw new Error('Unsupported JSON value');
}
try{
 const path=process.argv[2];
 if(!path||process.argv.length!==3||statSync(path).size>262144)throw new Error('file');
 const report=JSON.parse(readFileSync(path,'utf8'));
 if(report.application!=='veyra-compute'||![1,2].includes(report.schemaVersion))throw new Error('schema');
 const fields=['application','schemaVersion','runId','origin','startedAt','completedAt','durationMs','status','config','requests','statistics'];
 const evidence=Object.fromEntries(fields.map(key=>[key,report[key]]));
 evidence.requests=report.requests.map(request=>Object.fromEntries(Object.entries(request).filter(([key])=>key!=='verification'&&key!=='verificationMs')));
 const bytes=canonical({format:'veyra-benchmark-evidence',version:1,algorithm:'sha256',evidence});
 console.log(createHash('sha256').update(bytes,'utf8').digest('hex'));
}catch{
 console.error('Usage: node scripts/reproduce-proof.mjs VALIDATED_REPORT.json (at most 256 KiB).');
 process.exitCode=1;
}
