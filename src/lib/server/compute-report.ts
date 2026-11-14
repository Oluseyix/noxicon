import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, validateReport, reportVerificationSummarySchema as summary } from '../compute/report';
export { canonicalJson, validateReport } from '../compute/report';

export function digest(domain:'configuration'|'result'|'report',value:unknown,schemaVersion:1|2=1):string {
  return createHash('sha256').update(canonicalJson({application:'veyra-compute',schemaVersion,domain,value}),'utf8').digest('hex');
}
export function reportCommitments(value:unknown) {
  const report=validateReport(value);
  return {configurationCommitment:digest('configuration',report.config,report.schemaVersion),resultCommitment:digest('result',{requests:report.requests,statistics:report.statistics,verification:report.verification},report.schemaVersion),reportCommitment:digest('report',report,report.schemaVersion)};
}
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const benchmarkReceiptSchema=z.object({application:z.literal('veyra-compute'),schemaVersion:z.literal(1),network:z.literal('testnet'),runId:z.uuid(),configurationCommitment:hash,resultCommitment:hash,reportCommitment:hash,verification:summary}).strict();
export function constructBenchmarkReceipt(value:unknown) {
  const report=validateReport(value);
  if(report.schemaVersion!==1)throw new Error('Receipt construction for version 2 reports is not enabled');
  if(report.origin!=='live')throw new Error('Test fixtures cannot be published as benchmark receipts');
  return benchmarkReceiptSchema.parse({application:report.application,schemaVersion:report.schemaVersion,network:'testnet',runId:report.runId,...reportCommitments(report),verification:report.verification});
}
