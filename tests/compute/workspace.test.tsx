// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { statistics, verificationSummary } from '../../src/lib/compute/metrics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Workspace from '../../src/components/compute/workspace';
import { uiFixture } from './ui-fixture';
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({models:[],available:false,message:'Live testing is unavailable right now.'})}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function jsonFile(text:string){const file=new File([text],'report.json',{type:'application/json'});Object.defineProperty(file,'text',{value:async()=>text});return file;}
describe('Compute workspace',()=>{
  it.each([['groq','Groq'],['near-ai-cloud','NEAR AI Cloud'],['unknown','Cloud inference']])('labels the discovered provider %s accurately',async(provider,name)=>{
    vi.mocked(fetch).mockImplementation(async()=>Response.json({provider,models:[{id:'test/model',name:'Test model',maxOutputTokens:256}],message:'Ready.'}));
    const user=userEvent.setup();render(<Workspace/>);
    await screen.findByText('Test model');expect(document.querySelector('.vl-section-heading')?.textContent).toContain(name);
    if(provider==='groq')expect(document.querySelector('.vl-section-heading')?.textContent).not.toContain('NEAR AI Cloud');
    vi.mocked(fetch).mockImplementation(async()=>Response.json({models:[],available:false,message:'Unavailable.'},{status:503}));
    await user.click(screen.getByRole('button',{name:'Refresh models'}));await screen.findByText('Unavailable.');
    expect(document.querySelector('.vl-section-heading')?.textContent).toContain('Cloud inference');
  });
  it.each(['{bad','{}'])('uses Noxicon branding for rejected report imports: %s',async text=>{
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(text));
    const message=(await screen.findByRole('alert')).textContent;
    expect(message).toContain('Noxicon');expect(message).not.toContain('Veyra');
  });

  it('places recorded provider and run status before the unchanged success summary',async()=>{
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(readFileSync('evidence/groq-report.json','utf8')));
    const model=await screen.findByRole('heading',{name:'qwen/qwen3.8-27b',level:2});
    expect(document.querySelector('.nr-identity')?.textContent).toContain('Groq');
    expect(document.querySelector('.nr-identity')?.textContent).toContain('Run completed');
    expect(model.compareDocumentPosition(screen.getByText('100.0%'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Request timeline',level:2})).toBeTruthy();
  });

  it.each(['historical-success','failed-and-skipped'])('explains publication boundaries for %s without calling proof APIs',async kind=>{
    const text=kind==='historical-success'?readFileSync('evidence/groq-report.json','utf8'):JSON.stringify(uiFixture());
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(text));
    await screen.findByText('Your benchmark report.');
    await user.click(screen.getByText('Evidence and report fingerprints'));
    expect(screen.getAllByText('Publication status not checked here.')).toHaveLength(2);
    expect(screen.getByText('Completing a benchmark does not automatically publish a NEAR transaction. Export the report to preview its publication commitment. Publication is a separate, explicitly authorized operation.')).toBeTruthy();
    await user.click(screen.getByText('Publish and verify with the operator CLI'));
    expect(screen.getByText('npm run proof -- preview --report REPORT.json')).toBeTruthy();
    expect(screen.getByText('npm run proof -- verify --report REPORT.json --receipt RECEIPT.json')).toBeTruthy();
    expect(screen.getByText('npm run verify:demo')).toBeTruthy();
    expect(screen.getByText(/That receipt belongs to the historical demonstration, not a newly generated benchmark/)).toBeTruthy();
    await user.click(screen.getByText('Inspect local report fingerprints'));
    expect(screen.getByText(/These SHA-256 configuration, result and report hashes are local report fingerprints/)).toBeTruthy();
    expect(screen.getByText(/do not use them as the publication approval digest/)).toBeTruthy();
    const copy=document.body.textContent??'';
    for(const misleading of ['No receipt available','Publication is not connected','no transaction has been submitted','No receipt has been published here'])expect(copy).not.toContain(misleading);
    expect(vi.mocked(fetch).mock.calls.every(call=>call[0]==='/api/benchmarks/models')).toBe(true);
    expect(screen.getByText(kind==='historical-success'?'100.0%':'33.3%')).toBeTruthy();
    if(kind==='historical-success')expect(screen.getByText(/1 successful measured request reached the output token limit/)).toBeTruthy();
    else expect(screen.getByText(/These results do not represent a complete run/)).toBeTruthy();
  });

  it.each([true,false])('shows Not measured for zero attempts (warm-up stopped=%s)',async stopped=>{
    const report=uiFixture();report.config={...report.config,warmupRequests:stopped?1:0};
    const skipped=report.requests[2];
    report.requests=Array.from({length:3},(_,i)=>({...skipped,index:i+(stopped?1:0),promptIndex:(i+(stopped?1:0))%3}));
    if(stopped)report.requests.unshift({...skipped,index:0,promptIndex:0,phase:'warmup',status:'failed',errorCode:'empty_output',latencyMs:100,finishReason:'length'});
    report.statistics=statistics(report.requests);report.verification=verificationSummary(report.requests);
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(JSON.stringify(report)));
    if(stopped)expect(await screen.findByRole('heading',{name:'Benchmark stopped during warm-up'})).toBeTruthy();else expect(await screen.findByText('Not measured')).toBeTruthy();
    const summary=document.querySelector('.vn-success')?.textContent;
    if(stopped){expect(summary).toBeUndefined();expect(screen.queryByRole('heading',{name:'Request timeline'})).toBeNull();expect(screen.queryByText('Verification status')).toBeNull();}
    else expect(summary).toContain('No measured requests were attempted. 3 skipped.');
    expect(document.body.textContent).not.toContain('0.0%');
    expect(document.querySelector('.vc-metrics')).toBeNull();
    if(!stopped)expect(screen.getByText('Performance statistics unavailable: no successful measured requests.')).toBeTruthy();
    if(stopped){
      expect(screen.getByRole('heading',{name:'Benchmark stopped during warm-up'})).toBeTruthy();
      expect(screen.getByText(/output limit before returning an answer/)).toBeTruthy();
      await user.click(screen.getByRole('button',{name:'Adjust settings'}));
      expect((screen.getByLabelText('Output token limit') as HTMLSelectElement).value).toBe('96');
      expect(document.querySelector('.vl-advanced')?.hasAttribute('open')).toBe(true);
      expect(vi.mocked(fetch).mock.calls.every(call=>call[0]==='/api/benchmarks/models')).toBe(true);
    }
  });
  it.each([
    ['empty_output','stop','failed','The model finished without returning an answer.'],
    ['timeout',null,'timed_out','The warm-up request timed out.'],
    ['network_error',null,'failed','The provider could not complete the warm-up request.'],
    ['invalid_stream',null,'failed','incomplete or unreadable response'],
  ] as const)('distinguishes warm-up outcome %s',async(errorCode,finishReason,status,message)=>{
    const report=uiFixture();report.schemaVersion=2;report.status='provider_error';report.config={...report.config,warmupRequests:1};
    const skipped=report.requests[2];
    report.requests=Array.from({length:4},(_,index)=>({...skipped,index,promptIndex:index%3,phase:index===0?'warmup':'measured'}));
    report.requests[0]={...report.requests[0],status,errorCode,finishReason,latencyMs:100};
    report.statistics=statistics(report.requests);report.verification=verificationSummary(report.requests);
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(JSON.stringify(report)));
    await screen.findByRole('heading',{name:'Benchmark stopped during warm-up'});
    expect(document.querySelector('.nf-failure')?.textContent).toContain(message);
  });
  it('still displays the original successful Groq report and rate',async()=>{
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(readFileSync('evidence/groq-report.json','utf8')));
    expect(await screen.findByText('100.0%')).toBeTruthy();
    expect(screen.getByText('qwen/qwen3.8-27b')).toBeTruthy();
    expect(document.querySelector('.vn-success')?.textContent).toContain('1 of 1 configured measured requests succeeded');
    expect(screen.queryByText('Not measured')).toBeNull();
  });

  it('uses a provider-capped reasoning budget and allows explicit overrides',async()=>{
    vi.mocked(fetch).mockImplementation(async()=>Response.json({provider:'groq',models:[{id:'openai/gpt-oss-120b',name:'GPT-OSS',maxOutputTokens:256}],message:'Ready.'}));
    const user=userEvent.setup();render(<Workspace/>);
    await screen.findByText('GPT-OSS');expect(screen.queryByText(/GPT-OSS may use the completion budget/)).toBeNull();
    await user.click(screen.getByText('Advanced settings'));
    expect((screen.getByLabelText('Output token limit') as HTMLSelectElement).value).toBe('256');
    await user.selectOptions(screen.getByLabelText('Output token limit'),'128');
    expect((screen.getByLabelText('Output token limit') as HTMLSelectElement).value).toBe('128');
    expect(vi.mocked(fetch).mock.calls.every(call=>call[0]==='/api/benchmarks/models')).toBe(true);
  });
  it('validates bounded configuration and does not call a live provider',async()=>{
    const user=userEvent.setup();render(<Workspace/>);
    expect((screen.getByRole('button',{name:'Start benchmark'}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByText('Advanced settings'));
    await user.selectOptions(screen.getByLabelText('Measured requests'),'8');await user.selectOptions(screen.getByLabelText('Warm-up requests'),'2');
    await user.click(screen.getByRole('button',{name:'Check configuration'}));expect(screen.getByRole('status').textContent).toContain('10 requests maximum');expect(vi.mocked(fetch).mock.calls.every(call=>call[0]==='/api/benchmarks/models')).toBe(true);
  });
  it('inspects local values, labels fixture provenance and keeps old data after invalid import',async()=>{
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(JSON.stringify(uiFixture())));
    await screen.findByText('Test fixture · not a live benchmark');expect(screen.getByText('33.3%')).toBeTruthy();expect(document.querySelector('.vc-metrics')?.textContent).toContain('13.33');
    await user.click(screen.getByText('Technical details and individual requests'));await user.click(screen.getByRole('button',{name:'Inspect request 2'}));expect(screen.getByText('request failed')).toBeTruthy();
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile('{bad'));
    const alert=await screen.findByRole('alert');expect(alert.textContent).toContain('not valid JSON');expect(alert.compareDocumentPosition(document.querySelector('.vc-metrics')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByText('Test fixture · not a live benchmark')).toBeTruthy();expect(vi.mocked(fetch).mock.calls.every(call=>call[0]==='/api/benchmarks/models')).toBe(true);
  });
  it('does not present imported live-origin claims as freshly verified execution',async()=>{
    const user=userEvent.setup();render(<Workspace/>);
    await user.upload(screen.getByLabelText('Import benchmark report'),jsonFile(JSON.stringify({...uiFixture(),origin:'live'})));
    await screen.findByText('Declared live · origin not authenticated');
    expect(document.querySelector('.vn-verification-status')?.textContent).toContain('Not independently verified here');expect(document.querySelector('.vn-verification-status')?.textContent).toContain('Publication status not checked here.');
  });
  it('can cancel an in-progress import without applying a late result',async()=>{
    const user=userEvent.setup();render(<Workspace/>);
    let resolve!:(text:string)=>void;const file=new File(['pending'],'pending.json',{type:'application/json'});
    Object.defineProperty(file,'text',{value:()=>new Promise<string>(done=>{resolve=done;})});
    await user.upload(screen.getByLabelText('Import benchmark report'),file);
    await user.click(await screen.findByRole('button',{name:'Cancel import'}));resolve(JSON.stringify(uiFixture()));
    await waitFor(()=>expect(screen.queryByText('Test fixture · not a live benchmark')).toBeNull());expect(screen.getByRole('status').textContent).toContain('Import cancelled');
  });
});

describe('live workspace with controlled stream events',()=>{
 it('updates progress from observed content, then displays the validated report',async()=>{
  const {act}=await import('@testing-library/react');let stream!:ReadableStreamDefaultController<Uint8Array>;
  vi.mocked(fetch).mockImplementation(async url=>url==='/api/benchmarks/models'?Response.json({models:[{id:'test/model',name:'Test model',maxOutputTokens:256}],message:'Ready to benchmark.'}):new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'content-type':'application/x-ndjson'}}));
  const user=userEvent.setup();render(<Workspace/>);await waitFor(()=>expect((screen.getByRole('button',{name:'Start benchmark'}) as HTMLButtonElement).disabled).toBe(false));await user.click(screen.getByRole('button',{name:'Start benchmark'}));
  await act(async()=>{stream.enqueue(new TextEncoder().encode(JSON.stringify({type:'progress',progress:{stage:'measured',index:0,completed:0,total:4,status:null}})+'\n'+JSON.stringify({type:'activity',index:0,outputBytes:11})+'\n'));});
  expect(screen.getByText('Receiving content')).toBeTruthy();expect(screen.getByText('11 bytes')).toBeTruthy();expect(screen.getByRole('progressbar')).toBeTruthy();
  await act(async()=>{stream.enqueue(new TextEncoder().encode(JSON.stringify({type:'report',report:{...uiFixture(),origin:'live'}})+'\n'));stream.close();});
  expect(await screen.findByText('Your benchmark results.')).toBeTruthy();expect(screen.getByText('Live benchmark',{exact:true})).toBeTruthy();expect(document.querySelector('.vn-verification-status')?.textContent).toContain('Evidence unavailable');
 });
 it('keeps simple presets within a discovered model output limit',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({models:[{id:'test/model',name:'Small model',maxOutputTokens:32}],message:'Ready.'}));const user=userEvent.setup();render(<Workspace/>);await screen.findByText('Small model');await user.click(screen.getByRole('button',{name:/Detailed test/}));await user.click(screen.getByText('Advanced settings'));expect((screen.getByLabelText('Output token limit') as HTMLSelectElement).value).toBe('32');
 });
});
