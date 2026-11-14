import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
// Only the network and environment are mocked. The route, catalog adapter, SSE
// parser, runner, schema validation and commitment code execute together.
vi.mock('../../src/lib/server/compute-env',async importOriginal=>({...await importOriginal<typeof import('../../src/lib/server/compute-env')>(),computeConfiguration:()=> 'test-integration-server-secret',selectedProvider:()=> 'near-ai-cloud'}));
import { POST } from '../../src/app/api/benchmarks/route';
import { GET } from '../../src/app/api/benchmarks/models/route';
import { validateReport } from '../../src/lib/compute/report';
import { inspectReport } from '../../src/lib/compute/report-browser';
import { reportCommitments } from '../../src/lib/server/compute-report';
import { chunk } from './helpers';
const entry={id:'test/integration-model',max_output_length:256,input_modalities:['text'],output_modalities:['text'],supported_sampling_parameters:['temperature','top_p','max_tokens']};
const req=()=>new Request('http://localhost:3100/api/benchmarks',{method:'POST',headers:{host:'localhost:3100',origin:'http://localhost:3100','content-type':'application/json'},body:JSON.stringify({model:entry.id,measuredRequests:1,warmupRequests:1,maxOutputTokens:16})});
const getReq=()=>new Request('http://localhost:3100/api/benchmarks/models',{headers:{host:'localhost:3100','sec-fetch-site':'same-origin'}});
afterEach(()=>vi.unstubAllGlobals());
function stream(){return new Response(new ReadableStream({start(c){for(const e of [chunk('private provider output'),chunk(null,'stop'),{id:'completion-test',choices:[],usage:{completion_tokens:5}}])c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
describe('existing controls’ server contracts with mocked HTTP responses',()=>{
 it('discovers a provider model then runs warm-up and measured inference through the real engine',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).endsWith('/models')?Response.json({data:[entry]}):stream());vi.stubGlobal('fetch',request);
  const catalog=await GET(getReq());expect(await catalog.json()).toMatchObject({models:[{id:entry.id}],available:true});
  const response=await POST(req());expect(response.headers.get('content-type')).toBe('application/x-ndjson');const text=await response.text(),events=text.trim().split('\n').map(x=>JSON.parse(x));const report=validateReport(events.at(-1).report);
  expect(report.schemaVersion).toBe(2);expect(report.origin).toBe('live');expect(report.requests).toHaveLength(2);expect(report.statistics.successful).toBe(1);expect(report.verification.notRequested).toBe(1);expect(report.requests[1].outputTokens).toBe(5);
  expect(events.some(e=>e.type==='activity'&&e.outputBytes>0)).toBe(true);expect(text).not.toContain('private provider output');expect(text).not.toContain('test-integration-server-secret');
  expect(request.mock.calls.filter(c=>String(c[0]).endsWith('chat/completions'))).toHaveLength(2);expect(request.mock.calls.every(c=>['https://cloud-api.near.ai/v1/models','https://cloud-api.near.ai/v1/chat/completions'].includes(String(c[0])))).toBe(true);
  expect((await inspectReport(JSON.stringify(report))).commitments).toEqual(reportCommitments(report));
 });
 it('returns a sanitized failed report and actionable warning without retrying after a credit failure',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).endsWith('/models')?Response.json({data:[entry]}):Response.json({error:{message:'SECRET private response'}},{status:402}));vi.stubGlobal('fetch',request);
  const events=(await(await POST(req())).text()).trim().split('\n').map(x=>JSON.parse(x));expect(events.at(-1).type).toBe('report');expect(events.at(-1).warning).toContain('credits');expect(events.at(-1).report.requests[0].errorCode).toBe('insufficient_credits');expect(events.at(-1).report.requests[1].status).toBe('skipped');expect(JSON.stringify(events)).not.toContain('SECRET');expect(request).toHaveBeenCalledTimes(2);
 });
 it('makes discovery auth errors useful while enforcing the existing local read boundary',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(Response.json({error:{message:'PRIVATE'}},{status:401}));vi.stubGlobal('fetch',request);
  const response=await GET(getReq());expect(response.status).toBe(502);expect(await response.json()).toMatchObject({models:[],available:false,message:expect.stringContaining('API key')});
  const cross=new Request('http://localhost:3100/api/benchmarks/models',{headers:{host:'localhost:3100',origin:'https://attacker.test'}});expect((await GET(cross)).status).toBe(403);expect(request).toHaveBeenCalledOnce();
 });
});
