import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({publish:vi.fn(),verify:vi.fn(),configuration:vi.fn()}));
vi.mock('../../src/lib/server/proof-publication',()=>({publishProof:mock.publish}));
vi.mock('../../src/lib/server/proof-near',()=>({verifyProof:mock.verify}));
vi.mock('../../src/lib/server/proof-config',()=>({proofConfiguration:mock.configuration,TESTNET_RPCS:['https://test.rpc.fastnear.com','https://archival-rpc.testnet.near.org']}));
import { POST as publish } from '../../src/app/api/proofs/publish/route';
import { POST as verify } from '../../src/app/api/proofs/verify/route';
import { ProofError } from '../../src/lib/server/proof-format';

const token='a'.repeat(64),commitment='b'.repeat(64);
let clock=Date.now();
const request=(body:unknown={report:{},approvedCommitment:commitment},headers:Record<string,string>={})=>new Request('http://localhost:3100/api/proofs/publish',{
 method:'POST',headers:{host:'localhost:3100',origin:'http://localhost:3100',authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:JSON.stringify(body),
});
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});clock+=120000;vi.setSystemTime(clock);vi.stubEnv('VEYRA_PROOF_API_TOKEN',token);
 mock.configuration.mockReturnValue({publisher:'mock.testnet',verifyRpcUrl:'https://archival-rpc.testnet.near.org'});
});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();vi.useRealTimers();});
describe('explicit authenticated local proof API',()=>{
 it.each(['','Bearer wrong','Bearer '+'é'.repeat(64)])('rejects unauthorized requests before configuration or signing',async authorization=>{
  expect((await publish(request(undefined,{authorization}))).status).toBe(401);expect(mock.configuration).not.toHaveBeenCalled();expect(mock.publish).not.toHaveBeenCalled();
 });
 it('fails closed when API authorization is not configured',async()=>{
  vi.stubEnv('VEYRA_PROOF_API_TOKEN','');expect((await publish(request())).status).toBe(503);expect(mock.publish).not.toHaveBeenCalled();
 });
 it('rejects cross-origin/public-host calls and unexpected signing fields',async()=>{
  expect((await publish(request(undefined,{origin:'https://evil.test'}))).status).toBe(403);
  expect((await publish(new Request('https://public.test/api/proofs/publish',{method:'POST',headers:{host:'public.test',origin:'https://public.test',authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'}))).status).toBe(403);
  for(const extra of [{privateKey:'SECRET'},{publisher:'attacker.testnet'},{rpcUrl:'https://rpc.mainnet.near.org'},{network:'mainnet'},{actions:[]},{allowKeychain:true},{command:'near'},{keychainEntry:'arbitrary'},{publicKey:'arbitrary'}])expect((await publish(request({report:{},approvedCommitment:commitment,...extra}))).status).toBe(400);
  expect(mock.publish).not.toHaveBeenCalled();
 });
 it('requires exact-shaped explicit approval and never publishes for a verification request',async()=>{
  expect((await publish(request({report:{}}))).status).toBe(400);expect(mock.publish).not.toHaveBeenCalled();
  mock.verify.mockResolvedValue({verified:false,status:'pending'});expect((await verify(request({report:{},receipt:{}}))).status).toBe(200);expect(mock.publish).not.toHaveBeenCalled();
 });
 it('returns only confirmed publication as HTTP success, distinguishing pending/failed/uncertain',async()=>{
  for(const [state,status] of [['confirmed',200],['pending',202],['uncertain',202],['failed',422]] as const){
   mock.publish.mockResolvedValue({state,duplicate:false});const response=await publish(request());expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('no-store');
  }
 });
 it('sanitizes all unexpected errors and preserves safe configuration errors',async()=>{
  mock.publish.mockRejectedValue(new Error('PRIVATE_SIGNING_KEY'));const response=await publish(request());expect(await response.text()).not.toContain('PRIVATE_SIGNING_KEY');
  mock.publish.mockRejectedValue(new ProofError('disabled','Publication is disabled.',503));expect((await publish(request())).status).toBe(503);
 });
 it('bounds request size and enforces an authenticated rate limit',async()=>{
  expect((await publish(request({report:'x'.repeat(270337),approvedCommitment:commitment}))).status).toBe(413);
  mock.publish.mockResolvedValue({state:'confirmed'});let last:Response|undefined;
  for(let i=0;i<13;i++)last=await publish(request());expect(last!.status).toBe(429);expect(mock.publish.mock.calls.length).toBeLessThanOrEqual(12);
 });
});
