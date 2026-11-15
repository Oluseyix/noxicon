import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`outcome divider clearance ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 await page.route('**/api/benchmarks/models',r=>r.fulfill({json:{models:[],available:false,message:'Report inspection only.'}}));
 await page.goto('/app');await expect(page.getByText('Report inspection only.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'View sample report',exact:true}).click();
 const outcomes=page.locator('.vc-outcomes');await expect(outcomes).toBeVisible();
 await expect(outcomes).toHaveCSS('padding-bottom','24px');
 const gap=await outcomes.evaluate(e=>{const bottom=e.getBoundingClientRect().bottom;return Math.min(...[...e.children].map(c=>bottom-c.getBoundingClientRect().bottom));});
 expect(gap).toBeGreaterThanOrEqual(23);
 await page.locator('.vn-chart-row').first().click();
 await page.locator('.vn-request-chart').screenshot({path:info.outputPath(`timeline-${width}.png`),animations:'disabled'});
 await page.screenshot({path:info.outputPath(`outcomes-${width}.png`),fullPage:true,animations:'disabled'});
});
