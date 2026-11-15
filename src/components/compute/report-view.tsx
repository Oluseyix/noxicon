'use client';
import { useState, type ReactNode } from 'react';
import { providerNames } from '../../lib/compute/providers';
import type { BenchmarkReport, RequestResult } from '../../lib/compute/types';
import { displayMetric as metric } from '../../lib/compute/report-browser';
const outcome=(s:string)=>s.replaceAll('_',' ');
function LatencyPlot({rows}:{rows:RequestResult[]}) {
  const [selected,setSelected]=useState<number|null>(null);
  const observed=rows.filter(r=>r.latencyMs!==null);
  if(!observed.length)return <div className="vc-chart-empty">No timing was recorded for the selected request phase.</div>;
  const max=Math.max(1,...observed.map(r=>r.latencyMs!));
  const active=rows.find(r=>r.index===selected);
  return <div className="vn-request-chart" aria-label="Recorded request timings">
    <div className="vn-chart-scale"><span>Request</span><span>Duration relative to longest request</span><span>{metric(max)} ms</span></div>
    {rows.map((r,i)=><button key={r.index} className="vn-chart-row" aria-label={`View timing for request ${r.index+1}`} aria-pressed={selected===r.index} onClick={()=>setSelected(selected===r.index?null:r.index)}>
      <span className="vn-chart-index">{String(r.index+1).padStart(2,'0')}</span><span className="vn-bar-lane">{r.latencyMs!==null&&<span className={`vn-duration-bar ${r.status!=='success'?'vn-bar-failed':''}`} style={{width:r.latencyMs===null?'0%':`${r.latencyMs/max*100}%`,animationDelay:`${i*.08}s`}}/>}{r.ttftMs!==null&&<span className="vn-first-marker" style={{left:`${r.ttftMs/max*100}%`}}/>}{r.latencyMs===null&&<span className="vn-skipped">Not started</span>}</span><span className="vn-chart-value">{r.latencyMs===null?'—':`${metric(r.latencyMs)} ms`}<small>{outcome(r.status)}</small></span>
    </button>)}
    <p className="vn-chart-selection" aria-live="polite">{active?`Request ${active.index+1}: ${outcome(active.status)}. First content: ${active.ttftMs===null?'not recorded':metric(active.ttftMs)+' ms'}. Total latency: ${active.latencyMs===null?'not recorded':metric(active.latencyMs)+' ms'}.`:'Select a request to inspect its timing. The marker shows first content; the bar shows total latency.'}</p>
  </div>;
}
export default function ReportView({report,live=false,summary,warning,onReviewSettings,onRetry512}:{report:BenchmarkReport;live?:boolean;summary?:ReactNode;warning?:string;onReviewSettings?:()=>void;onRetry512?:()=>void}) {
  const [phase,setPhase]=useState<'measured'|'warmup'>('measured');
  const [selected,setSelected]=useState<number|null>(null);
  const rows=report.requests.filter(r=>r.phase===phase);
  const request=rows.find(r=>r.index===selected)??rows[0];
  const s=report.statistics;
  const warmupFailure=s.attempted===0?report.requests.find(r=>r.phase==='warmup'&&['failed','timed_out','cancelled'].includes(r.status)):undefined;
  const warmupExplanation=warmupFailure?.errorCode==='empty_output'
    ?warmupFailure.finishReason==='length'?`The model reached its ${report.config.maxOutputTokens}-token output limit before returning an answer.`:'The model finished without returning an answer.'
    :warmupFailure?.status==='timed_out'?'The warm-up request timed out.'
    :warmupFailure?.status==='cancelled'?'The warm-up was cancelled.'
    :warmupFailure?.errorCode==='invalid_stream'?'The provider returned an incomplete or unreadable response.'
    :'The provider could not complete the warm-up request.';
  const displayWarning=warning?.replace(/^(Groq|NEAR AI Cloud)(?= )/, 'The provider');
  const truncated=report.requests.filter(r=>r.phase==='measured'&&r.status==='success'&&r.finishReason==='length').length;
  if(warmupFailure)return <section className="nf-failure" aria-labelledby="failure-title">
    <div className="nf-context"><span>{report.config.provider?providerNames[report.config.provider]:'Benchmark'}</span><span>{report.config.model}</span>{!live&&<span>Imported report</span>}</div>
    <div className="nf-status" role="status"><span className="nf-status-icon" aria-hidden="true">!</span><div><h2 id="failure-title">Benchmark stopped during warm-up</h2><p>{warmupExplanation}</p></div></div>
    <ol className="nf-steps" aria-label="Benchmark stages">
      <li className="is-complete"><span aria-hidden="true">✓</span><strong>Setup</strong><small>Complete</small></li>
      <li className="is-stopped" aria-current="step"><span aria-hidden="true">!</span><strong>Warm-up</strong><small>Stopped</small></li>
      <li><span aria-hidden="true">3</span><strong>Measurement</strong><small>Not started</small></li>
      <li><span aria-hidden="true">4</span><strong>Results</strong><small>Unavailable</small></li>
    </ol>
    <div className="nf-actions">{onRetry512&&<button className="vn-button nf-retry" onClick={onRetry512}>Retry with 512 tokens <span aria-hidden="true">↻</span></button>}{onReviewSettings&&<button className={`vn-button ${onRetry512?'nf-adjust':'nf-retry'}`} onClick={onReviewSettings}>Adjust settings</button>}</div>
    <details className="nf-details"><summary>Technical details</summary><dl>
      <div><dt>Output limit</dt><dd>{report.config.maxOutputTokens} tokens</dd></div>
      <div><dt>Reported output tokens</dt><dd>{warmupFailure.tokenSource==='reported'?(warmupFailure.outputTokens??'Not recorded'):'Not recorded'}</dd></div>
      <div><dt>Finish reason</dt><dd>{warmupFailure.finishReason??'Not recorded'}</dd></div>
      <div><dt>Outcome</dt><dd>{outcome(warmupFailure.status)} · {warmupFailure.errorCode??'No code'}</dd></div>
      <div><dt>Measured requests</dt><dd>{s.attempted} attempted · {s.skipped} skipped</dd></div>
      <div><dt>Request timeout</dt><dd>{report.config.requestTimeoutMs/1000} seconds</dd></div>
      <div><dt>Run ID</dt><dd>{report.runId}</dd></div>
      <div><dt>Started</dt><dd>{new Date(report.startedAt).toISOString()}</dd></div>
    </dl>{displayWarning&&<div className="nf-diagnostic"><h3>Provider diagnostics</h3><p>{displayWarning}</p></div>}</details>
  </section>;
  return <div className="vc-report-view">
    <div className="vc-report-meta"><div><span className="vc-kicker">{live?'RUN RECORD':'IMPORTED REPORT'}</span><h2>{report.config.model}</h2><div className="nr-identity"><span>{report.config.provider?providerNames[report.config.provider]:'Provider not recorded'}</span><span>{warmupFailure?'Warm-up incomplete':`Run ${outcome(report.status)}`}</span></div><p>{new Date(report.startedAt).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})} UTC</p></div><span className="vc-source-badge">{live?'Live benchmark':report.origin==='test-fixture'?'Test fixture · not a live benchmark':'Declared live · origin not authenticated'}</span></div>
    {!live&&<p className="vc-import-boundary">Measurements below are read from your file and checked for internal consistency. Import does not independently authenticate the runner, timing, or execution evidence.</p>}
    {warning&&!warmupFailure&&<p className="vn-feedback nr-provider-warning" role="alert">{displayWarning}</p>}

    {!warmupFailure&&summary}
    {!warmupFailure&&(s.successful>0?<div className="vc-metrics" aria-label="Measured request summary"><div><span>Responsiveness</span><strong>{metric(s.ttftMs.p50)}<small>ms</small></strong><p>Time to first token · median content arrival</p></div><div><span>P50 request latency</span><strong>{metric(s.latencyMs.p50)}<small>ms</small></strong><p>Nearest-rank median</p></div><div><span>P95 request latency</span><strong>{metric(s.latencyMs.p95)}<small>ms</small></strong><p>{s.latencyMs.samples} successful samples</p></div><div><span>Generation speed</span><strong>{metric(s.throughput.reported.mean,'rate')}<small>tok/s</small></strong><p>Reported tokens / total request time · {s.throughput.reported.samples} samples</p></div></div>:<p className="vc-chart-empty">Performance statistics unavailable: no successful measured requests.</p>)}
    {!warmupFailure&&<div className="vc-outcomes"><span><b>{s.successful}</b> successful</span><span><b>{s.failed}</b> failed <small>(includes {s.timedOut} timed out, {s.cancelled} cancelled)</small></span><span><b>{s.skipped}</b> skipped</span><span><b>{report.config.warmupRequests}</b> warm-ups excluded</span></div>}
    {truncated>0&&<p className="vc-import-boundary">{truncated} successful measured {truncated===1?'request reached':'requests reached'} the output token limit. Output may be incomplete. Success describes stream completion, not answer completeness or quality.</p>}
    {s.skipped>0&&s.attempted>0&&<p className="vc-import-boundary">Only {s.attempted} of {report.config.measuredRequests} configured measured requests were attempted; {s.skipped} were skipped. These results do not represent a complete run.</p>}
    {s.throughput.estimated.samples>0&&<p className="vc-estimate">Estimated output throughput: <strong>{metric(s.throughput.estimated.mean,'rate')} tok/s</strong> across {s.throughput.estimated.samples} samples. Visible UTF-8 bytes ÷ 4, not a tokenizer count. Kept separate from reported usage.</p>}
    {!warmupFailure&&<details className="nr-run-details" open={warmupFailure?undefined:true}><summary>Request records and methodology</summary>
    <div className="vc-chart-heading"><div><p className="vc-kicker">REQUEST BY REQUEST</p><h2>Request timeline</h2></div><div className="vc-segment" role="group" aria-label="Request phase"><button aria-pressed={phase==='measured'} onClick={()=>{setPhase('measured');setSelected(null);}}>Measured</button><button aria-pressed={phase==='warmup'} onClick={()=>{setPhase('warmup');setSelected(null);}}>Warm-ups</button></div></div>
    {rows.length?<><div className="vc-plot-legend"><span><i/>Total latency</span><span><i/>First content</span><span><i/>Failed request</span><small>Select a request for detail</small></div><LatencyPlot key={phase} rows={rows}/><details className="vn-technical"><summary>Technical details and individual requests</summary><p className="vc-table-hint">Scroll the table horizontally to inspect every measurement.</p><div className="vc-table-wrap" tabIndex={0} role="region" aria-label="Request measurements, scroll horizontally"><table><caption className="sr-only">{phase} request measurements</caption><thead><tr><th>Request</th><th>Outcome</th><th>First content</th><th>Total latency</th><th>Output tokens</th><th>Usage source</th></tr></thead><tbody>{rows.map(r=><tr key={r.index} className={request?.index===r.index?'is-selected':''}><td><button onClick={()=>setSelected(r.index)} aria-pressed={request?.index===r.index} aria-label={`Inspect request ${r.index+1}`}>{String(r.index+1).padStart(2,'0')}</button></td><td>{outcome(r.status)}</td><td>{metric(r.ttftMs)}{r.ttftMs!==null?' ms':''}</td><td>{metric(r.latencyMs)}{r.latencyMs!==null?' ms':''}</td><td>{r.outputTokens??'—'}</td><td>{r.tokenSource}</td></tr>)}</tbody></table></div>
    {request&&<details className="vc-request-detail" open><summary>Request {request.index+1} · inspect the record</summary><dl><div><dt>Completion ID</dt><dd>{request.completionId??'Not recorded'}</dd></div><div><dt>Finish reason</dt><dd>{request.finishReason==='length'?'Token limit reached (truncated)':request.finishReason??'No completion'}</dd></div><div><dt>Outcome detail</dt><dd>{request.errorCode?outcome(request.errorCode):'Completed stream'}</dd></div><div><dt>Signature status</dt><dd>{outcome(request.verification.status)}{live?'':' · not reverified'}</dd></div><div><dt>Verification duration</dt><dd>{metric(request.verificationMs)}{request.verificationMs!==null?' ms':''}</dd></div><div><dt>Token scope</dt><dd>{outcome(request.tokenScope)}</dd></div></dl></details>}</details></>:<div className="vc-chart-empty">No warm-up requests were included in this run.</div>}
    <details className="vc-detail"><summary>How to read these measurements</summary><dl className="nr-methodology"><div><dt>First content</dt><dd>Arrival of the first visible content chunk, not an individual GPU token.</dd></div><div><dt>Total latency</dt><dd>Dispatch through the end of the stream, including reported usage.</dd></div><div><dt>Throughput</dt><dd>Completion tokens divided by total request time, not raw GPU decoding speed. Provider counts may include reasoning tokens.</dd></div><div><dt>P50 and P95</dt><dd>Nearest rank over successful measured requests. A small run cannot establish provider-wide tail latency.</dd></div><div><dt>Excluded outcomes</dt><dd>Failed requests remain in the table and are excluded from successful distributions. Warm-ups are excluded from measured statistics.</dd></div><div><dt>Missing data</dt><dd>A dash means no measurement is available.</dd></div></dl></details>
    <details className="vc-detail"><summary>Exact run configuration</summary><dl className="vc-config-summary"><div><dt>Workload</dt><dd>{report.config.workload}</dd></div><div><dt>Measured / warm-up requests</dt><dd>{report.config.measuredRequests} / {report.config.warmupRequests}</dd></div><div><dt>Concurrency</dt><dd>{report.config.concurrency}</dd></div><div><dt>Maximum output tokens</dt><dd>{report.config.maxOutputTokens}</dd></div><div><dt>Request timeout</dt><dd>{report.config.requestTimeoutMs/1000} seconds</dd></div><div><dt>Temperature / top-p</dt><dd>{report.config.temperature} / {report.config.topP}</dd></div><div><dt>Run ID</dt><dd>{report.runId}</dd></div></dl><div className="nr-prompts"><div className="nr-system-instruction"><h3>System instruction</h3><p>{report.config.system}</p></div><h3>Test prompts</h3><ol>{report.config.prompts.map((prompt,index)=><li key={index}>{prompt}</li>)}</ol></div></details>
    </details>}
  </div>;
}
