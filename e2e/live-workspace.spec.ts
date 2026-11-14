import { test, expect } from '@playwright/test';
import { uiFixture } from '../tests/compute/ui-fixture';
// Controlled browser integration responses. These tests never call a provider.
const model={id:'test/model',name:'Browser test model',maxOutputTokens:256};
test('launches, observes streaming progress and renders a server report',async({page},info)=>{
 await page.route('**/api/benchmarks/models',route=>route.fulfill({json:{models:[model],available:true,message:'Ready to benchmark.'}}));
 let release!:(value?:unknown)=>void;const gate=new Promise(resolve=>{release=resolve;});
 const report={...uiFixture(),origin:'live'};
 await page.route('**/api/benchmarks',async route=>{await gate;await route.fulfill({contentType:'application/x-ndjson',body:[{type:'preparing'},{type:'progress',progress:{stage:'measured',index:0,completed:0,total:3,status:null}},{type:'activity',index:0,outputBytes:11},{type:'report',report}].map(e=>JSON.stringify(e)).join('\n')+'\n'});});
 await page.goto('/app');await expect(page.getByRole('button',{name:'Start benchmark'})).toBeEnabled();await page.getByRole('button',{name:'Start benchmark'}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('Preparing your test.');await expect(page.getByRole('button',{name:'Cancel test'})).toBeVisible();await page.screenshot({path:info.outputPath('running.png'),fullPage:true,animations:'disabled'});release();await expect(page.getByRole('heading',{level:1})).toHaveText('Your benchmark results.');await expect(page.getByText('Live benchmark',{exact:true})).toBeVisible();await expect(page.locator('.vn-verification-status')).toContainText('Evidence unavailable');await expect(page.locator('.vc-metrics')).toContainText('13.33');await page.screenshot({path:info.outputPath('live-results.png'),fullPage:true,animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('cancels a pending request and recovers from a server error',async({page})=>{
 await page.route('**/api/benchmarks/models',route=>route.fulfill({json:{models:[model],available:true,message:'Ready to benchmark.'}}));
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/benchmarks',async route=>{await gate;await route.fulfill({status:429,json:{error:{message:'The hourly test budget has been reached.'}}}).catch(()=>{});});
 await page.goto('/app');await page.getByRole('button',{name:'Start benchmark'}).click();await page.getByRole('button',{name:'Cancel test'}).click();await expect(page.getByRole('status')).toContainText('Test cancelled');release();await page.getByRole('button',{name:'Start benchmark'}).click();await expect(page.locator('main').getByRole('alert')).toContainText('hourly test budget');await expect(page.getByRole('button',{name:'Start benchmark'})).toBeEnabled();
});
test('model-area refresh shows pending, failed and recovered catalog states',async({page})=>{
 let count=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/benchmarks/models',async route=>{
  count++;
  if(count===1)return route.fulfill({json:{models:[],available:false,message:'Live testing is unavailable right now.'}});
  if(count===2){await gate;return route.fulfill({status:503,body:'unavailable'});}
  return route.fulfill({json:{models:[model],available:true,message:'Ready to benchmark.'}});
 });
 await page.goto('/app');const refresh=page.getByRole('button',{name:'Refresh models',exact:true});await expect(refresh).toBeEnabled();await refresh.click();await expect(refresh).toBeDisabled();await expect(refresh).toHaveAttribute('aria-busy','true');await expect(page.locator('#model-help')).toHaveText('Checking available models…');release();await expect(page.locator('#model-help')).toContainText('Live testing is unavailable');await expect(refresh).toBeEnabled();await refresh.click();await expect(page.getByLabel('Model',{exact:true})).toHaveValue(model.id);await expect(page.getByRole('button',{name:'Start benchmark'})).toBeEnabled();
});

for(const provider of [{id:'near-ai-cloud' as const,name:'NEAR AI Cloud'},{id:'groq' as const,name:'Groq'}])test(`renders ${provider.name} version 2 reports and errors without changing the workspace`,async({page})=>{
 const {statistics,verificationSummary}=await import('../src/lib/compute/metrics');
 const {mapVerification}=await import('../src/lib/compute/verification');
 const report=uiFixture();report.origin='live';report.schemaVersion=2;report.status='provider_error';
 report.config={...report.config,provider:provider.id};
 report.requests[0]={...report.requests[0],outputTokens:null,tokenSource:'unavailable',tokenScope:'unavailable',throughputTokensPerSecond:null};
 report.requests[1].errorCode='provider_rate_limit';for(const request of report.requests)request.verification=mapVerification();
 report.statistics=statistics(report.requests);report.verification=verificationSummary(report.requests);
 const warning=`${provider.name} rate-limited this test. No automatic retry was made.`;
 await page.route('**/api/benchmarks/models',route=>route.fulfill({json:{provider:provider.id,models:[model],available:true,message:'Ready to benchmark.'}}));
 await page.route('**/api/benchmarks',route=>route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'report',report,warning})+'\n'}));
 await page.goto('/app');await expect(page.locator('.vl-section-heading').filter({has:page.getByRole('heading',{name:'Start a benchmark',exact:true})})).toContainText(provider.name);await page.getByRole('button',{name:'Start benchmark'}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('Your benchmark results.');
 await expect(page.locator('.vc-metrics')).toContainText('0 samples');await expect(page.locator('.vc-estimate')).toHaveCount(0);await expect(page.locator('.vn-verification-status')).toContainText('Not requested');await expect(page.locator('main').getByRole('alert')).toHaveText('The provider rate-limited this test. No automatic retry was made.');
 await page.getByText('Evidence and report fingerprints',{exact:true}).click();await expect(page.getByText('Attestation was not requested for this benchmark.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to launcher'}).click();
 await page.route('**/api/benchmarks/models',route=>route.fulfill({status:502,json:{models:[],available:false,message:`${provider.name} rejected the API key or its permissions.`}}));
 await page.getByRole('button',{name:'Refresh models',exact:true}).click();await expect(page.locator('#model-help')).toContainText('API key');await expect(page.getByRole('button',{name:'Start benchmark'})).toBeDisabled();
});
