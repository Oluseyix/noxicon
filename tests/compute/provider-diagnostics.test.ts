import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { logProviderFailure, logModelRouteFailure } from '../../src/lib/server/provider-diagnostics';
import { selectedProvider } from '../../src/lib/server/compute-env';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it.each([[401,'invalid_credentials'],[403,'forbidden'],[429,'rate_limited'],[500,'upstream_http_error']] as const)('logs actual HTTP %s without response secrets', (status,category)=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 logProviderFailure('groq','models',new Error('Bearer SECRET'),status);
 expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({upstreamStatus:status,category});expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
});
it.each([['ENOTFOUND','dns_failure'],['ECONNRESET','network_failure']] as const)('identifies %s safely',(code,category)=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 logProviderFailure('groq','models',new Error('SECRET',{cause:{code,secret:'SECRET'}}));
 expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({networkCode:code,category});expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
});
it('logs only presence of bindings and selects the sole configured Groq provider',()=>{
 vi.stubEnv('GROQ_API_KEY','SECRET');vi.stubEnv('NEAR_AI_API_KEY','');vi.stubEnv('VEYRA_COMPUTE_PROVIDER',undefined);
 expect(selectedProvider()).toBe('groq');
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});logModelRouteFailure('boundary',503);
 expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
 expect(JSON.parse(log.mock.calls[0][0]).environment.groqKeyPresent).toBe(true);
 vi.stubEnv('VEYRA_COMPUTE_PROVIDER','near-ai-cloud');expect(selectedProvider()).toBe('near-ai-cloud');
});
it('identifies an unsupported cache runtime without leaking error text',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});logProviderFailure('groq','models',new TypeError('Unsupported cache mode: no-store SECRET'));
 expect(JSON.parse(log.mock.calls[0][0]).category).toBe('runtime_cache_incompatible');expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
});
