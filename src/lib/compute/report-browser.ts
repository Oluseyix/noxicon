import { canonicalJson, validateReport } from './report';
export type ReportCommitments={configurationCommitment:string;resultCommitment:string;reportCommitment:string};
async function digest(domain:'configuration'|'result'|'report',value:unknown,schemaVersion:1|2=1) {
  const bytes=new TextEncoder().encode(canonicalJson({application:'veyra-compute',schemaVersion,domain,value}));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function inspectReport(text:string) {
  if(new TextEncoder().encode(text).byteLength>262144)throw new Error('Choose a benchmark report smaller than 256 KB.');
  let data:unknown;
  try {data=JSON.parse(text);}catch{throw new Error('This file is not valid JSON. Choose an exported Noxicon report.');}
  let report;
  try {report=validateReport(data);}catch{throw new Error('This report does not match the Noxicon report format, or its measurements and summary disagree. Your current report has been kept.');}
  const [configurationCommitment,resultCommitment,reportCommitment]=await Promise.all([
    digest('configuration',report.config,report.schemaVersion),digest('result',{requests:report.requests,statistics:report.statistics,verification:report.verification},report.schemaVersion),digest('report',report,report.schemaVersion),
  ]);
  return {report,commitments:{configurationCommitment,resultCommitment,reportCommitment}};
}
export type InspectedReport=Awaited<ReturnType<typeof inspectReport>>;
export function displayMetric(value:number|null|undefined,unit:'ms'|'rate'='ms') {
  if(value==null)return '—';
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:unit==='rate'?2:1}).format(value);
}
