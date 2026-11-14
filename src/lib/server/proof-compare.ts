import 'server-only';
import { canonicalJson } from '../compute/report';
import { proofCommitment, publicationEvidence } from './proof-format';

// Compare validated, committed evidence only. JSON Pointer paths, never values:
// reports may contain private prompts even when their commitments are public.
export function compareProofEvidence(before:unknown,after:unknown){
 const left=publicationEvidence(before),right=publicationEvidence(after);
 const changedPaths:string[]=[];
 const escape=(key:string)=>key.replaceAll('~','~0').replaceAll('/','~1');
 function visit(a:unknown,b:unknown,path:string){
  if(a!==undefined&&b!==undefined&&canonicalJson(a)===canonicalJson(b))return;
  if(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
   for(const key of [...new Set([...Object.keys(x),...Object.keys(y)])].sort())visit(x[key],y[key],`${path}/${escape(key)}`);
  }else changedPaths.push(path);
 }
 visit(left,right,'');
 const beforeCommitment=proofCommitment(before).commitment,afterCommitment=proofCommitment(after).commitment;
 return {sameCommitment:beforeCommitment===afterCommitment,beforeCommitment,afterCommitment,changedPaths};
}
