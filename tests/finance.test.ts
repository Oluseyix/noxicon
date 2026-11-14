import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseCsv,calculate,percentage,definitions} from '../src/lib/finance';
import {canonical,commitment,datasetCommitment,receipt,receiptSchema} from '../src/lib/commitments';
const csv=readFileSync('public/samples/financial-records.csv','utf8');
const rows=parseCsv(csv), salt='a'.repeat(64);
describe('CSV validation',()=>{
 it('accepts fictional records',()=>expect(rows).toHaveLength(8));
 for(const [name,from,to] of [ ['negative','12500.00','-1.00'],['precision','12500.00','1.001'],['date','2026-09-04','2026-09-31'],['currency','USD','EUR'],['customer','cust-a',''],['classification','customer_payment','unknown'] ])
 it(`rejects ${name}`,()=>expect(()=>parseCsv(csv.replace(from,to))).toThrow());
 it('rejects duplicate IDs',()=>expect(()=>parseCsv(csv+'\n'+csv.split('\n')[1])).toThrow(/Duplicate/));
 it('rejects missing columns',()=>expect(()=>parseCsv('date\n2026-10-01')).toThrow());
 it('rejects empty records',()=>expect(()=>parseCsv(csv.split('\n')[0])).toThrow());
});
describe('deterministic financial calculations',()=>{
 it('computes all monetary totals in cents',()=>expect(calculate(rows)).toEqual({total:100000000n,classified:70000000n,returning:42000000n,internal:20000000n,unclassified:10000000n,other:28000000n}));
 it('compares denominators',()=>{const r=calculate(rows);expect(percentage(r.returning,r.total)).toBe('42.00%');expect(percentage(r.returning,r.classified)).toBe('60.00%');});
 it('requires prior classified payment',()=>expect(calculate(rows.filter(r=>!r.date.startsWith('2026-09'))).returning).toBe(0n));
 it('does not count internal history',()=>expect(calculate(rows.map(r=>r.date.startsWith('2026-09')?{...r,classification:'internal' as const}:r)).returning).toBe(0n));
 it('handles empty denominators and rounds',()=>{expect(percentage(0n,0n)).toBeNull();expect(percentage(2n,3n)).toBe('66.67%');expect(()=>percentage(-1n,1n)).toThrow();});
});
describe('commitments and receipts',()=>{
 it('canonicalizes key order',()=>expect(canonical({b:1,a:2})).toBe(canonical({a:2,b:1})));
 it('reproduces dataset commitment independent of row order',async()=>expect(await datasetCommitment(rows,salt)).toBe(await datasetCommitment([...rows].reverse(),salt)));
 it('detects changed input',async()=>expect(await datasetCommitment(rows,salt)).not.toBe(await datasetCommitment(rows.slice(1),salt)));
 it('separates domains and salts',async()=>{expect(await commitment('result',{},salt)).not.toBe(await commitment('calculation',{},salt));expect(await commitment('result',{},salt)).not.toBe(await commitment('result',{},'b'.repeat(64)));});
 it('rejects invalid salt and noncanonical values',async()=>{await expect(commitment('result',{},'')).rejects.toThrow();expect(()=>canonical(undefined)).toThrow();});
 it('constructs commitment-only receipt',async()=>{const r=receipt(await datasetCommitment(rows,salt),await commitment('calculation',definitions.all,salt),await commitment('result',calculate(rows),salt));expect(Object.keys(r)).toHaveLength(6);expect(receiptSchema.safeParse({...r,customer_id:'secret'}).success).toBe(false);expect(()=>receipt('bad','bad','bad')).toThrow();});
});
