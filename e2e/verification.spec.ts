import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const original=JSON.parse(readFileSync('evidence/groq-report.json','utf8'));
const viewports=[{width:375,height:812},{width:768,height:1024},{width:1280,height:800},{width:1440,height:900},{width:1920,height:1000},{width:390,height:844}];
for(const viewport of viewports)test(`dedicated verification page at ${viewport.width}px`,async({page},info)=>{
 await page.setViewportSize(viewport);const api:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
 await page.goto('/verify');await expect(page.locator('.lab-page')).toHaveCSS('font-family', /-apple-system/);await expect(page.getByRole('heading',{level:1})).toHaveText('Evidence Laboratory');
 await expect(page.locator('.lab-metrics>div').last()).toContainText('Measured requestOriginal evidence');
 await expect(page.locator('.lab-section-head').first()).not.toContainText('Original evidence');
 const eyebrow=await page.locator('.lab-heading .lab-eyebrow').boundingBox(), title=await page.locator('.lab-heading h1').boundingBox(), subtitle=await page.locator('.lab-heading p:last-child').boundingBox();
 expect(title!.y-(eyebrow!.y+eyebrow!.height)).toBeGreaterThanOrEqual(18);
 expect(subtitle!.y-(title!.y+title!.height)).toBeGreaterThanOrEqual(20);
 expect(await page.locator('.lab-boundary').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
 await expect(page.getByText('Local digest matches receipt',{exact:true})).toBeVisible();
 await expect(page.locator('.lab-status')).toContainText('Not checked');expect(api).toEqual([]);
 await expect(page.locator('canvas')).toHaveCount(0);
 const primary=page.getByRole('button',{name:'Verify on NEAR',exact:true});const bounds=await primary.boundingBox();expect(bounds!.width).toBeGreaterThan(200);
 if(viewport.width>=1000){const left=await page.locator('.lab-summary').boundingBox();const right=await page.locator('.lab-verification').boundingBox();expect(right!.x).toBeGreaterThan(left!.x);expect(Math.abs(left!.y-right!.y)).toBeLessThan(2);const timeline=await page.locator('.lab-replay').boundingBox();expect(timeline!.width).toBeGreaterThan(250);}
 const timing=await page.locator('.lab-arrival').evaluate(el=>parseFloat((el as HTMLElement).style.left));expect(timing).toBeCloseTo(235.583958/356.052958*100,3);

 await page.getByRole('button',{name:'Change model',exact:true}).click();await expect(page.getByText('MISMATCH',{exact:true})).toBeVisible();
 await expect(page.locator('.lab-change ins')).toHaveText('modified/model');await expect(page.locator('.lab-change del')).toHaveText('qwen/qwen3.8-27b');
 await expect(page.locator('.lab-change')).toContainText('Model identifier changed');expect(api).toEqual([]);
 await page.getByRole('button',{name:'Add 10 ms latency'}).click();await expect(page.locator('.lab-change')).toContainText('Total latency changed');await expect(page.getByText('MISMATCH',{exact:true})).toBeVisible();
 await expect(page.locator('.lab-change ins')).toHaveText(`${(original.requests[0].latencyMs+10).toFixed(3)} ms`);await expect(page.locator('.lab-metrics')).toContainText('356.1');expect(api).toEqual([]);
 await page.getByRole('button',{name:'Restore original',exact:true}).click();await expect(page.getByText('Local digest matches receipt',{exact:true})).toBeVisible();await expect(page.locator('.lab-change ins')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`proof-explorer-${viewport.width}.png`),fullPage:true,animations:'disabled'});
 await page.locator('.lab-technical>summary').click();await page.locator('.lab-technical-groups>details').filter({has:page.locator('summary').filter({hasText:/^Report$/})}).locator('summary').click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download genuine report'}).click();expect((await download).suggestedFilename()).toBe('noxicon-historical-report.json');
 await page.locator('.lab-technical-groups>details>summary').filter({hasText:'Reproduce'}).click();
 await expect(page.getByText('npm ci\nnpm run verify:demo',{exact:true})).toBeVisible();
 await expect(page.locator('.lab-nav nav')).toHaveCount(0);await page.getByRole('link',{name:'Noxicon home',exact:true}).click();await expect(page).toHaveURL(/\/$/);
});
test('keyboard and reduced-motion access preserve the proof workflow',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/verify');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
 const button=page.getByRole('button',{name:'Change model',exact:true});await button.focus();await page.keyboard.press('Enter');await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.getByText('MISMATCH',{exact:true})).toBeVisible();
});
const result={result:{verified:true,status:'verified',code:'commitment_verified',message:'Mocked finalized-chain check for browser automation only.'},checkedAt:'2026-11-13T12:00:00Z',transactionHash:'CHzwHrtoUYfPMj1uHrqNeNCBv2fLVht1mT3gQunQYurQ',publisher:'veyra-proof.testnet',network:'testnet'};
test('explicit RPC check distinguishes original publication from local modified evidence',async({page})=>{
 let calls=0;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});await page.route('**/api/demo/verify',async route=>{calls++;await gate;return route.fulfill({json:result});});
 await page.goto('/verify');expect(calls).toBe(0);await page.getByRole('button',{name:'Verify on NEAR'}).click();await expect(page.getByRole('heading',{name:'Checking publication…'})).toBeVisible();await expect(page.getByText('Looking up the finalized NEAR transaction.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Checking NEAR…'})).toBeDisabled();await expect(page.getByText('Evidence verified',{exact:true})).toHaveCount(0);release();
 await expect(page.getByText('Evidence verified',{exact:true})).toBeVisible();expect(calls).toBe(1);
 await page.getByRole('button',{name:'Change model',exact:true}).click();await expect(page.getByText('MISMATCH',{exact:true})).toBeVisible();await expect(page.getByText('Evidence verified',{exact:true})).toBeVisible();await expect(page.locator('.lab-verdict')).toContainText('original report');await expect(page.locator('.lab-boundary')).toContainText('original’s NEAR result');expect(calls).toBe(1);
 await page.route('**/api/demo/verify',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));await page.getByRole('button',{name:'Verify on NEAR'}).click();await expect(page.locator('main').getByRole('alert')).toContainText('unavailable');await expect(page.getByText('Evidence verified',{exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Verification unavailable'})).toBeVisible();
});


for(const status of ['failed','pending','mismatch','unavailable'])test(`honestly displays RPC outcome ${status}`,async({page})=>{
 await page.route('**/api/demo/verify',r=>r.fulfill({json:{...result,result:{verified:false,status,code:'fixture_'+status,message:'Mocked '+status+' response.'}}}));
 await page.goto('/verify');await page.getByRole('button',{name:'Verify on NEAR'}).click();
 await expect(page.locator('.lab-verdict')).toContainText('Mocked '+status+' response.');
 await expect(page.getByText('Evidence verified',{exact:true})).toHaveCount(0);
});

test('historical replay and digest copy are genuine local interactions',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.goto('/verify');await expect(page.getByText('Local digest matches receipt',{exact:true})).toBeVisible();
 const calls:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});
 await page.getByRole('button',{name:'Replay request',exact:true}).click();
 await expect(page.getByText('Recorded completion',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'235.6 ms',exact:true}).click();await expect(page.locator('.lab-replay-readout')).toContainText('Receiving content');
 await page.getByRole('button',{name:'Copy published commitment',exact:true}).click();
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('7ba15a1cb551de64840d2748fd73f13c0ad8b32dce424429d404877dedc9545c');
 expect(calls).toEqual([]);
});
