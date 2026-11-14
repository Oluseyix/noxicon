import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({configuration:vi.fn(),prepare:vi.fn(),reserve:vi.fn(),run:vi.fn()}));
vi.mock('../../src/lib/server/compute-env',()=>({computeConfiguration:mock.configuration}));
vi.mock('../../src/lib/server/compute-provider',()=>({computeProvider:()=>({id:'near-ai-cloud',prepareTransport:mock.prepare})}));
vi.mock('../../src/lib/server/compute-budget',()=>({reserveRun:mock.reserve}));
vi.mock('../../src/lib/server/compute-runner',()=>({runBenchmark:mock.run}));
import { BoundaryError } from '../../src/lib/server/compute-http';
import { POST } from '../../src/app/api/benchmarks/route';
import { uiFixture } from './ui-fixture';
const req=(signal?:AbortSignal)=>new Request('http://localhost:3100/api/benchmarks',{method:'POST',headers:{host:'localhost:3100',origin:'http://localhost:3100','content-type':'application/json'},body:JSON.stringify({model:'test/model',measuredRequests:1,warmupRequests:0}),signal});
afterEach(()=>vi.clearAllMocks());
describe('live endpoint orchestration with mocked transport/engine',()=>{
 it('streams observed events and exact engine report, releases the quota and transport resources',async()=>{
  const release=vi.fn(),close=vi.fn(),report={...uiFixture(),origin:'live'};mock.configuration.mockReturnValue('server-secret');mock.reserve.mockReturnValue(release);mock.prepare.mockResolvedValue({transport:{},close});mock.run.mockImplementation(async(_config,_transport,options)=>{options.onProgress({stage:'measured',index:0,completed:0,total:1,status:null});options.onActivity({index:0,outputBytes:12});return report;});
  const response=await POST(req());const text=await response.text(),events=text.trim().split('\n').map(s=>JSON.parse(s));expect(events.map(e=>e.type)).toEqual(['preparing','progress','activity','report']);expect(events[3].report).toEqual(report);expect(text).not.toContain('server-secret');expect(close).toHaveBeenCalledOnce();expect(release).toHaveBeenCalledOnce();
 });
 it('sanitizes unexpected upstream failures',async()=>{
  mock.reserve.mockReturnValue(vi.fn());mock.prepare.mockRejectedValue(new Error('Authorization: secret-key'));const response=await POST(req());const text=await response.text();expect(text).not.toContain('secret-key');expect(text).toContain('could not complete');expect(mock.run).not.toHaveBeenCalled();
 });
 it('propagates client disconnects into the runner signal',async()=>{
  mock.prepare.mockResolvedValue({transport:{},close:vi.fn()});let seen:AbortSignal|undefined;mock.run.mockImplementation(async(_c,_t,o)=>{seen=o.signal;return new Promise(resolve=>o.signal.addEventListener('abort',()=>resolve(uiFixture()),{once:true}));});const abort=new AbortController();const response=await POST(req(abort.signal));await new Promise(resolve=>setTimeout(resolve,0));abort.abort();await response.text();expect(seen?.aborted).toBe(true);
 });
 it('does not reserve a paid budget when configuration is unavailable',async()=>{
  mock.configuration.mockImplementation(()=>{throw new BoundaryError(503,'No inference requests were sent.');});const response=await POST(req());expect(response.status).toBe(503);expect(mock.reserve).not.toHaveBeenCalled();expect(mock.prepare).not.toHaveBeenCalled();
 });
});
