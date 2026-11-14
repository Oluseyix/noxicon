import { test,expect } from '@playwright/test';
test('marketing homepage has no WebGL workload or background API requests',async({page})=>{
 const api:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
 await page.addInitScript(()=>{Object.assign(window,{__layoutShift:0});new PerformanceObserver(list=>{for(const entry of list.getEntries()){const shift=entry as PerformanceEntry & {hadRecentInput:boolean;value:number};if(!shift.hadRecentInput)Reflect.set(window,'__layoutShift',Reflect.get(window,'__layoutShift')+shift.value);}}).observe({type:'layout-shift',buffered:true});});
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('AI claims.');await page.waitForTimeout(1500);
 await expect(page.locator('canvas')).toHaveCount(0);expect(api).toEqual([]);
 expect(await page.evaluate(()=>Reflect.get(window,'__layoutShift'))).toBeLessThan(.05);
 expect(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('accelerator.webp')))).toBe(false);
});
