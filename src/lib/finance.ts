import Papa from 'papaparse';
import { z } from 'zod';

const text = z.string().min(1).max(256);
const schema = z.object({
  transaction_id: text,
  date: z.string().regex(/^2026-(09|10)-\d{2}$/).refine(v => {
    const d = new Date(v); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === v;
  }, 'Invalid calendar date'),
  currency: z.literal('USD'),
  amount: z.string().regex(/^(0|[1-9]\d{0,15})\.\d{2}$/),
  customer_id: z.string().max(256), sender: text, recipient: text,
  classification: z.enum(['customer_payment', 'internal', 'unclassified']),
}).strict().refine(r => r.classification !== 'customer_payment' || r.customer_id.length > 0, 'Customer payment needs customer_id');
export type RecordRow = z.infer<typeof schema>;
export function parseCsv(csv: string): RecordRow[] {
  if (csv.length > 5_000_000) throw new Error('CSV exceeds 5 MB character limit');
  const parsed = Papa.parse<Record<string,string>>(csv, {header:true, skipEmptyLines:'greedy'});
  if (parsed.errors.length) throw new Error(parsed.errors.map(e=>e.message).join('; '));
  const fields = ['transaction_id','date','currency','amount','customer_id','sender','recipient','classification'];
  if (parsed.meta.fields?.length !== fields.length || fields.some(f=>!parsed.meta.fields?.includes(f))) throw new Error('Invalid CSV columns');
  if (!parsed.data.length) throw new Error('CSV has no records');
  const seen = new Set<string>();
  return parsed.data.map((r,i)=>{
    const result = schema.safeParse(r);
    if (!result.success) throw new Error(`Row ${i+2}: ${result.error.message}`);
    if (seen.has(result.data.transaction_id)) throw new Error('Duplicate transaction ID');
    seen.add(result.data.transaction_id); return result.data;
  });
}
export const cents = (amount:string):bigint => BigInt(amount.replace('.',''));
export const definitions = {
  all: {version:1, numerator:'October returning customer payments', denominator:'All October transfers', returning:'September classified customer payment with same customer ID', currency:'USD'},
  classified: {version:1, numerator:'October returning customer payments', denominator:'October classified customer payments', returning:'September classified customer payment with same customer ID', currency:'USD'},
  breakdown: {version:1, method:'Sum October transfers by supplied classification', currency:'USD'},
} as const;
export function calculate(rows: RecordRow[]) {
  const prior = new Set(rows.filter(r=>r.date.startsWith('2026-09') && r.classification==='customer_payment').map(r=>r.customer_id));
  let total=0n, classified=0n, returning=0n, internal=0n, unclassified=0n;
  for (const r of rows.filter(r=>r.date.startsWith('2026-10'))) {
    const value=cents(r.amount); total+=value;
    if(r.classification==='customer_payment') { classified+=value; if(prior.has(r.customer_id)) returning+=value; }
    else if(r.classification==='internal') internal+=value; else unclassified+=value;
  }
  return {total,classified,returning,internal,unclassified,other:classified-returning};
}
// Hundredths of a percent, rounded half up. Zero denominator is undefined.
export function percentage(n:bigint,d:bigint):string|null {
  if(n<0n || d<0n) throw new Error('Negative ratio');
  if(d===0n) return null;
  const bp=(n*10000n+d/2n)/d;
  return `${bp/100n}.${(bp%100n).toString().padStart(2,'0')}%`;
}
