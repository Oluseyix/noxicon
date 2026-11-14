import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createDemoVerification } from '../../src/lib/server/demo-verification';
import { publicationPreview } from '../../src/lib/compute/publication-preview';
import { proofCommitment } from '../../src/lib/server/proof-format';
const report=JSON.parse(readFileSync('evidence/groq-report.json','utf8'));
const ok={verified:true,status:'verified' as const,code:'commitment_verified',message:'Checked.'};
const request=(options:RequestInit={},query='')=>new Request('https://noxicon.example/api/demo/verify'+query,{method:'POST',headers:{origin:'https://noxicon.example'},...options});
afterEach(()=>vi.unstubAllGlobals());
describe('fixed public historical verification boundary',()=>{
 it('allows an explicit same-origin check without keys and returns pinned attribution',async()=>{
  const check=vi.fn().mockResolvedValue(ok);const res=await createDemoVerification(check)(request());
  expect(res.status).toBe(200);expect(await res.json()).toMatchObject({result:ok,publisher:'veyra-proof.testnet',network:'testnet',transactionHash:'CHzwHrtoUYfPMj1uHrqNeNCBv2fLVht1mT3gQunQYurQ'});expect(check).toHaveBeenCalledTimes(1);
 });
 it('supports the real Host when Next canonicalizes its internal request URL',async()=>{
  const check=vi.fn().mockResolvedValue(ok);const req=new Request('http://localhost:3182/api/demo/verify',{method:'POST',headers:{host:'127.0.0.1:3182',origin:'http://127.0.0.1:3182','sec-fetch-site':'same-origin'}});
  expect((await createDemoVerification(check)(req)).status).toBe(200);expect(check).toHaveBeenCalledTimes(1);
 });
 it('rejects cross-site browser metadata even with a matching Host',async()=>{
  const check=vi.fn();expect((await createDemoVerification(check)(request({headers:{origin:'https://noxicon.example','sec-fetch-site':'cross-site'}}))).status).toBe(403);expect(check).not.toHaveBeenCalled();
 });
 it('accepts the empty body stream used by the Next HTTP adapter',async()=>{
  const check=vi.fn().mockResolvedValue(ok);const req=request({body:new ReadableStream({start(controller){controller.close();}}),duplex:'half'} as RequestInit);
  expect((await createDemoVerification(check)(req)).status).toBe(200);expect(check).toHaveBeenCalledTimes(1);
 });
 it.each([undefined,'https://evil.example'])('rejects missing or foreign origin %s',async origin=>{
  const check=vi.fn();const res=await createDemoVerification(check)(request({headers:origin?{origin}:{}}));expect(res.status).toBe(403);expect(check).not.toHaveBeenCalled();
 });
 it.each(['?rpc=https://evil.example','?account=other.testnet'])('rejects query configuration %s',async query=>{
  const check=vi.fn();expect((await createDemoVerification(check)(request({},query))).status).toBe(400);expect(check).not.toHaveBeenCalled();
 });
 it('rejects all submitted report/action bodies',async()=>{
  const check=vi.fn();expect((await createDemoVerification(check)(request({body:'{"action":"publish"}'}))).status).toBe(400);expect(check).not.toHaveBeenCalled();
 });
 it('limits checks to four per minute per process without retries',async()=>{
  let time=100000;const check=vi.fn().mockResolvedValue(ok),route=createDemoVerification(check,()=>time);
  for(let i=0;i<4;i++)expect((await route(request())).status).toBe(200);
  expect((await route(request())).status).toBe(429);expect(check).toHaveBeenCalledTimes(4);
  time+=60000;expect((await route(request())).status).toBe(200);
 });
 it('allows only one in-flight verification',async()=>{
  let release!:(value:typeof ok)=>void;const check=vi.fn(()=>new Promise<typeof ok>(resolve=>{release=resolve;}));const route=createDemoVerification(check);const pending=route(request());
  expect((await route(request())).status).toBe(429);release(ok);expect((await pending).status).toBe(200);expect(check).toHaveBeenCalledTimes(1);
 });
 it.each(['failed','pending','unavailable','mismatch'] as const)('never promotes %s to verified',async status=>{
  const result={verified:false,status,code:'test',message:'Not verified'};expect(await (await createDemoVerification(async()=>result)(request())).json()).toMatchObject({result});
 });
 it('handles RPC exceptions without leaking their contents or retrying',async()=>{
  const check=vi.fn().mockRejectedValue(new Error('private diagnostic'));const res=await createDemoVerification(check)(request());expect(res.status).toBe(503);expect(await res.text()).not.toContain('private diagnostic');expect(check).toHaveBeenCalledTimes(1);
 });
});
describe('independent browser publication digest',()=>{
 it.each(['evidence/groq-report.json','public/examples/benchmark.json'])('matches the unchanged server algorithm for %s',async path=>{
  vi.stubGlobal('crypto',webcrypto);const value=JSON.parse(readFileSync(path,'utf8'));expect(await publicationPreview(value)).toBe(proofCommitment(value).commitment);
 });
 it('rejects changed model evidence against the historical digest',async()=>{
  vi.stubGlobal('crypto',webcrypto);const copy=structuredClone(report);copy.config.model='modified/model';expect(await publicationPreview(copy)).not.toBe(proofCommitment(report).commitment);expect(await publicationPreview(report)).toBe('7ba15a1cb551de64840d2748fd73f13c0ad8b32dce424429d404877dedc9545c');
 });
 it('rejects inconsistent evidence rather than hashing arbitrary input',async()=>{
  vi.stubGlobal('crypto',webcrypto);await expect(publicationPreview({})).rejects.toThrow();
 });
});
