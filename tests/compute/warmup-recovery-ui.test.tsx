// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Workspace from '../../src/components/compute/workspace';
import { uiFixture } from './ui-fixture';
import { statistics, verificationSummary } from '../../src/lib/compute/metrics';
import type { BenchmarkReport } from '../../src/lib/compute/types';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function failure(tokens:number){
 const report=uiFixture();report.schemaVersion=2;report.origin='live';report.status='provider_error';report.config={...report.config,model:'openai/gpt-oss-120b',provider:'groq',warmupRequests:1,maxOutputTokens:tokens};
 const skipped=report.requests[2];report.requests=Array.from({length:4},(_,index)=>({...skipped,index,promptIndex:index%3,phase:index===0?'warmup':'measured'}));
 report.requests[0]={...report.requests[0],status:'failed',errorCode:'empty_output',finishReason:'length',latencyMs:100};
 report.statistics=statistics(report.requests);report.verification=verificationSummary(report.requests);return report;
}
it.each(['failed','successful'])('handles manual retry through loading to a %s outcome',async ending=>{
 vi.stubGlobal('crypto',webcrypto);
 const failed=failure(96),next=failure(512);
 if(ending==='successful'){
  const success=uiFixture().requests[0];next.status='completed';next.requests=next.requests.map(r=>({...success,index:r.index,promptIndex:r.promptIndex,phase:r.phase}));next.statistics=statistics(next.requests);next.verification=verificationSummary(next.requests);
 }
 const reply=(report:BenchmarkReport)=>new Response(JSON.stringify({type:'report',report,warning:report.status==='provider_error'?'Finish reason: length. Provider completion tokens: 96; reasoning tokens: 94.':undefined})+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
 const bodies:unknown[]=[];let finishRetry!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(url==='/api/benchmarks/models')return Response.json({provider:'groq',models:[{id:'openai/gpt-oss-120b',name:'GPT-OSS',maxOutputTokens:512}],message:'Ready.'});
  bodies.push(JSON.parse(options.body));if(bodies.length===1)return reply(failed);
  return new Promise<Response>(resolve=>{finishRetry=resolve;});
 }));
 const user=userEvent.setup();render(<Workspace/>);await screen.findByText('GPT-OSS');
 await user.click(screen.getByText('Advanced settings'));await user.selectOptions(screen.getByLabelText('Output token limit'),'96');await user.click(screen.getByRole('button',{name:'Start benchmark'}));
 await screen.findByRole('heading',{name:'Benchmark stopped during warm-up'});
 expect(document.querySelector('.nf-details')?.hasAttribute('open')).toBe(false);
 expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Warm-upStopped');
 expect(screen.queryByRole('progressbar')).toBeNull();
 await user.click(screen.getByRole('button',{name:'Retry with 512 tokens'}));
 await screen.findByRole('button',{name:'Cancel test'});expect(screen.queryByRole('button',{name:'Retry with 512 tokens'})).toBeNull();
 await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[1]).toMatchObject({maxOutputTokens:512,warmupRequests:1,measuredRequests:3});
 finishRetry(reply(next));
 if(ending==='failed'){
  await screen.findByRole('heading',{name:'Benchmark stopped during warm-up'});expect(screen.queryByRole('button',{name:'Retry with 512 tokens'})).toBeNull();
  expect(screen.getByRole('button',{name:'Adjust settings'})).toBeTruthy();expect(document.querySelector('.nf-details')?.hasAttribute('open')).toBe(false);
 }else{await screen.findByText('Your benchmark results.');expect(document.querySelector('.nf-failure')).toBeNull();expect(screen.getByText('100.0%')).toBeTruthy();}
 expect(bodies).toHaveLength(2);
});
