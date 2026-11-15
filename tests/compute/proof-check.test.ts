import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const verify=vi.hoisted(()=>vi.fn());
vi.mock('../../src/lib/server/proof-near',()=>({verifyProof:verify}));
import { POST } from '../../src/app/api/proofs/check/route';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const request=(origin='http://localhost:3000')=>new Request('http://localhost:3000/api/proofs/check',{method:'POST',headers:{host:'localhost:3000',origin,'content-type':'application/json'},body:JSON.stringify({report:{runId:'test'},receipt:{publisher:'untrusted.testnet'}})});
it('verifies without signing credentials against an independently configured publisher',async()=>{
 vi.stubEnv('NEAR_TESTNET_PUBLISHER','trusted.testnet');vi.stubEnv('NEAR_TESTNET_VERIFY_RPC_URL','https://archival-rpc.testnet.near.org');
 verify.mockResolvedValue({verified:false,status:'mismatch',message:'Wrong publisher'});
 const response=await POST(request());expect(response.status).toBe(200);
 expect(verify.mock.calls[0][2]).toBe('trusted.testnet');expect((await response.json()).status).toBe('mismatch');
});
it('rejects cross-origin requests before verification',async()=>{
 expect((await POST(request('https://other.example'))).status).toBe(403);expect(verify).not.toHaveBeenCalled();
});
it('rejects an arbitrary RPC endpoint before verification',async()=>{
 vi.stubEnv('NEAR_TESTNET_VERIFY_RPC_URL','https://other.example');expect((await POST(request())).status).toBe(503);expect(verify).not.toHaveBeenCalled();
});
