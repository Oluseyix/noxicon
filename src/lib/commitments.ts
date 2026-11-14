import { z } from 'zod';
import type { RecordRow } from './finance';
export function canonical(value:unknown):string {
  if(typeof value==='bigint') return JSON.stringify(value.toString());
  if(value===null || typeof value==='string' || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(typeof value==='object' && value!==null) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  throw new Error('Unsupported commitment value');
}
export async function commitment(domain:'dataset'|'calculation'|'result',value:unknown,salt:string):Promise<string> {
  if(!/^[a-f0-9]{64}$/.test(salt)) throw new Error('Expected private 32-byte hex salt');
  const data = new TextEncoder().encode(canonical({application:'veyra',version:1,domain,salt,value}));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function datasetCommitment(rows:RecordRow[],salt:string) {
  return commitment('dataset',[...rows].sort((a,b)=>a.transaction_id<b.transaction_id?-1:a.transaction_id>b.transaction_id?1:0),salt);
}
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const receiptSchema=z.object({application:z.literal('veyra'),version:z.literal(1),network:z.literal('testnet'),inputCommitment:hash,calculationCommitment:hash,resultCommitment:hash}).strict();
export function receipt(inputCommitment:string,calculationCommitment:string,resultCommitment:string) {
  return receiptSchema.parse({application:'veyra',version:1,network:'testnet',inputCommitment,calculationCommitment,resultCommitment});
}
