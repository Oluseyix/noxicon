import { calculate, definitions, percentage, type RecordRow } from './finance';
import { commitment, datasetCommitment } from './commitments';

export type ChallengeKind = keyof typeof definitions;
export const challengeOptions: {kind: ChallengeKind; title: string; description: string}[] = [
  {kind:'all', title:'Returning share of all transfers', description:'Include every October transfer in the denominator, including internal and unclassified transfers.'},
  {kind:'classified', title:'Returning share of customer payments', description:'Limit the denominator to October transfers classified as customer payments.'},
  {kind:'breakdown', title:'October transfer breakdown', description:'Separate customer payments, internal transfers and unclassified transfers.'},
];
export function disclosure(rows: RecordRow[], kind: ChallengeKind) {
  const r = calculate(rows);
  return kind === 'breakdown'
    ? {currency:'USD', period:'2026-10', customerPaymentsCents:r.classified.toString(), internalCents:r.internal.toString(), unclassifiedCents:r.unclassified.toString(), totalCents:r.total.toString()}
    : {currency:'USD', period:'2026-10', returningCents:r.returning.toString(), denominatorCents:(kind==='all'?r.total:r.classified).toString(), share:percentage(r.returning,kind==='all'?r.total:r.classified)};
}
export type Evidence = Awaited<ReturnType<typeof createEvidence>>;
export async function createEvidence(rows: RecordRow[], kind: ChallengeKind, salt: string) {
  const result = disclosure(rows,kind);
  const definition = definitions[kind];
  const [inputHash, calculationHash, resultHash] = await Promise.all([
    datasetCommitment(rows,salt), commitment('calculation',definition,salt), commitment('result',result,salt),
  ]);
  return {application:'veyra', version:1, execution:'local-browser', publication:'not-published', kind, definition, result, commitments:{dataset:inputHash,calculation:calculationHash,result:resultHash}} as const;
}
export type Challenge = {id: number; kind: ChallengeKind; status:'pending'|'declined'|'approved'; evidence?: Evidence; aiAllowed?: boolean};
export function money(value: bigint | string) {
  const n = BigInt(value);
  return `$${(n/100n).toLocaleString('en-US')}.${(n%100n).toString().padStart(2,'0')}`;
}
