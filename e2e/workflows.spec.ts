import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { uiFixture } from '../tests/compute/ui-fixture';
// Keep historical UI workflows independent of configured real cloud credentials.
test.beforeEach(async({page})=>{
 await page.route('**/api/benchmarks/models',route=>route.fulfill({json:{models:[],available:false,message:'Test fixture: no cloud model selected.'}}));
});
for(const width of [375,390,768,1280,1440,1920,2560])test(`complete experience at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
 const api:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('AI claims.');await page.getByRole('link',{name:'Explore the proof'}).click();await expect(page).toHaveURL(/\/verify$/);
 await expect(page.getByText('Local digest matches receipt',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(api).toEqual([]);
 await page.getByRole('link',{name:'Noxicon home',exact:true}).click();await expect(page).toHaveURL(/\/$/);await page.getByRole('link',{name:'Create a report',exact:true}).click();await expect(page).toHaveURL(/\/app$/);
 await expect(page.getByRole('heading',{level:1})).toContainText('Know what your AI');await expect(page.getByText('Verification status',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Start benchmark'})).toBeDisabled();await expect(page.getByLabel('Measured requests',{exact:true})).toBeHidden();
 await page.getByRole('button',{name:'Refresh models',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh models',exact:true})).toBeEnabled();
 await expect(page.getByText('Inside a benchmark',{exact:true})).toHaveCount(0);await expect(page.locator('.vb-story')).toHaveCount(0);await expect(page.getByRole('tablist',{name:'Inside a benchmark'})).toHaveCount(0);

 const layout=await page.evaluate(()=>{
  const box=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
  const model=box('#benchmark-model'),choices=box('.vn-test-choice'),advanced=box('.vl-advanced'),start=box('.vl-start');
  const buttons=[...document.querySelectorAll('.vn-test-choice>button')].map(b=>b.getBoundingClientRect());
  const reports=[...document.querySelectorAll('.vl-report-actions>button')].map(b=>b.getBoundingClientRect());
  return {vertical:model.bottom<=choices.top&&choices.bottom<=advanced.top&&advanced.bottom<=start.top,aligned:[choices,advanced,start].every(b=>Math.abs(b.left-model.left)<1&&Math.abs(b.width-model.width)<1),equalOptions:Math.abs(buttons[0].width-buttons[1].width)<1,reportsStacked:reports[1].top>=reports[0].bottom,reportsEqual:Math.abs(reports[0].width-reports[1].width)<1,refreshInModel:!!document.querySelector('.vl-model-label .vl-refresh'),privacyInReports:!!document.querySelector('.vl-reports .vl-privacy')};
 });
 expect(layout).toEqual({vertical:true,aligned:true,equalOptions:true,reportsStacked:width<=560,reportsEqual:true,refreshInModel:true,privacyInReports:true});
 await expect(page.locator('.vl-advanced')).not.toHaveAttribute('open','');
 await page.screenshot({path:info.outputPath(`launcher-${width}.png`),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:/Detailed test/}).click();await page.getByText('Advanced settings',{exact:true}).click();await expect(page.getByLabel('Measured requests',{exact:true})).toHaveValue('8');
 for(const [label,value] of [['Measured requests','5'],['Warm-up requests','0'],['Output token limit','64'],['Concurrency','2'],['Request timeout (seconds)','60']])await page.getByLabel(label,{exact:true}).selectOption(value);
 await page.getByText('View fixed prompts',{exact:true}).click();await expect(page.getByText('Explain in two sentences why measuring network latency differs from measuring GPU execution time.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check configuration'}).click();await expect(page.getByRole('status')).toContainText('5 requests maximum');
 await page.screenshot({path:info.outputPath(`controls-${width}.png`),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:/Quick test/}).click();await expect(page.getByLabel('Measured requests',{exact:true})).toHaveValue('3');
 await page.getByRole('button',{name:'View sample report'}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('Explore an example report.');await expect(page.locator('.vn-example-note')).toContainText('synthetic');await expect(page.locator('.vc-metrics')).toContainText('13.33');
 await page.getByRole('button',{name:'View timing for request 2',exact:true}).click();await expect(page.locator('.vn-chart-selection')).toContainText('500 ms');
 await page.screenshot({path:info.outputPath(`results-${width}.png`),fullPage:true,animations:'disabled'});
 await page.getByText('Technical details and individual requests',{exact:true}).click();await page.getByRole('button',{name:'Inspect request 2'}).click();await expect(page.getByText('request failed',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Warm-ups',exact:true}).click();await expect(page.getByText('No warm-up requests were included in this run.')).toBeVisible();await page.getByRole('button',{name:'Measured',exact:true}).click();
 for(const text of ['How to read these measurements','Exact run configuration','Evidence and report fingerprints','Inspect local report fingerprints'])await page.getByText(text,{exact:true}).click();await expect(page.locator('.vc-hash code')).toHaveCount(3);await page.screenshot({path:info.outputPath(`disclosures-${width}.png`),fullPage:true,animations:'disabled'});
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const file=await(await downloading).path();expect(JSON.parse(readFileSync(file!,'utf8'))).toEqual(JSON.parse(readFileSync('public/examples/benchmark.json','utf8')));
 await page.getByRole('button',{name:'Back to launcher'}).click();await expect(page.getByRole('button',{name:'Return to loaded report'})).toHaveCount(0);await page.getByRole('button',{name:'View sample report'}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('Explore an example report.');
 await page.getByLabel('Import benchmark report',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await expect(page.locator('main').getByRole('alert')).toContainText('not valid JSON');
 await page.getByLabel('Import benchmark report',{exact:true}).setInputFiles({name:'report.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(uiFixture()))});await expect(page.getByRole('heading',{level:1})).toHaveText('Your benchmark report.');await expect(page.locator('.vn-example-note')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(api.every(url=>url.endsWith('/api/benchmarks/models'))).toBe(true);expect(errors).toEqual([]);
 await page.getByRole('link',{name:'Home',exact:true}).click();await expect(page).toHaveURL('/');
});
test('reduced motion, keyboard access and example loading failure',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();await expect(page.locator('canvas')).toHaveCount(0);
 await page.getByRole('link',{name:'Explore the proof'}).click();await page.getByRole('button',{name:'Change model',exact:true}).click();await expect(page.getByText('MISMATCH',{exact:true})).toBeVisible();
 await page.goto('/app');await page.route('**/examples/benchmark.json',route=>route.fulfill({status:503,body:'unavailable'}));await page.getByRole('button',{name:'View sample report'}).click();await expect(page.locator('main').getByRole('alert')).toContainText('could not be loaded');await expect(page.getByRole('heading',{level:1})).toContainText('Know what');
});
