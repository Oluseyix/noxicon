import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, definitions } from '../src/lib/finance';
import { commitment } from '../src/lib/commitments';
import { createEvidence, disclosure, money } from '../src/lib/challenges';
const rows=parseCsv(readFileSync('public/samples/financial-records.csv','utf8'));
const salt='b'.repeat(64);
describe('approved disclosure scope',()=>{
  it('discloses only the requested ratio and its inputs',()=>{
    expect(disclosure(rows,'all')).toEqual({currency:'USD',period:'2026-10',returningCents:'42000000',denominatorCents:'100000000',share:'42.00%'});
    expect(disclosure(rows,'classified').share).toBe('60.00%');
    expect(disclosure(rows,'classified').denominatorCents).toBe('70000000');
  });
  it('breakdown excludes individual customers and returning totals',()=>{
    expect(disclosure(rows,'breakdown')).toEqual({currency:'USD',period:'2026-10',customerPaymentsCents:'70000000',internalCents:'20000000',unclassifiedCents:'10000000',totalCents:'100000000'});
  });
  it('handles zero denominators without an invented result',()=>expect(disclosure(rows.filter(r=>r.date.startsWith('2026-09')),'all').share).toBeNull());
  it('updates disclosures when records change',()=>expect(disclosure(rows.filter(r=>r.transaction_id!=='oct-001'),'all').share).not.toBe('42.00%'));
});
describe('local evidence',()=>{
  it('binds the exact disclosed result and definition',async()=>{
    const e=await createEvidence(rows,'all',salt);
    expect(e.commitments.result).toBe(await commitment('result',e.result,salt));
    expect(e.commitments.calculation).toBe(await commitment('calculation',definitions.all,salt));
    expect(e.publication).toBe('not-published');
    expect(e.execution).toBe('local-browser');
  });
  it('excludes raw records, identities and private salt from export',async()=>{
    const json=JSON.stringify(await createEvidence(rows,'breakdown',salt));
    for(const secret of [salt,'cust-a','wallet-a','transaction_id','sender','recipient'])expect(json).not.toContain(secret);
  });
  it('keeps dataset binding stable across different challenges',async()=>{
    const a=await createEvidence(rows,'all',salt),b=await createEvidence(rows,'classified',salt);
    expect(a.commitments.dataset).toBe(b.commitments.dataset);
    expect(a.commitments.calculation).not.toBe(b.commitments.calculation);
    expect(a.commitments.result).not.toBe(b.commitments.result);
  });
  it('formats large integer cents without losing precision',()=>expect(money(999999999999999999n)).toBe('$9,999,999,999,999,999.99'));
});
