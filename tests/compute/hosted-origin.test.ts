import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { assertBenchmarkOrigin, assertBenchmarkReadOrigin } from '../../src/lib/server/compute-http';

afterEach(()=>vi.unstubAllEnvs());
describe('hosted benchmark boundaries',()=>{
 it('supports production behind a proxy without Vercel markers',()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('VERCEL','');
  const headers={host:'noxicon.example',origin:'https://noxicon.example','sec-fetch-site':'same-origin'};
  expect(()=>assertBenchmarkReadOrigin(new Request('http://localhost/api/benchmarks/models',{headers}))).not.toThrow();
  expect(()=>assertBenchmarkOrigin(new Request('http://localhost/api/benchmarks',{method:'POST',headers}))).not.toThrow();
 });
 it('rejects foreign origins and cross-site discovery in production',()=>{
  vi.stubEnv('NODE_ENV','production');
  for(const guard of [assertBenchmarkOrigin,assertBenchmarkReadOrigin]){
   expect(()=>guard(new Request('https://noxicon.example/api/benchmarks',{headers:{host:'noxicon.example',origin:'https://foreign.example'}}))).toThrow();
   expect(()=>guard(new Request('https://noxicon.example/api/benchmarks',{headers:{host:'noxicon.example','sec-fetch-site':'cross-site'}}))).toThrow();
  }
 });
});
