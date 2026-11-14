import { test,expect } from '@playwright/test';
for(const width of [375,768,1280,1440])test(`marketing homepage introduces the product at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const calls:string[]=[];page.on('request',request=>{if(request.url().includes('/api/'))calls.push(request.url());});
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('AI claims.');
 await expect(page.getByRole('link',{name:'Explore the proof'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Verify historical publication'})).toHaveCount(0);await expect(page.locator('canvas')).toHaveCount(0);
 const challenge=page.getByRole('button',{name:'Challenge',exact:true});await challenge.focus();await page.keyboard.press('Enter');await expect(challenge).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('heading',{name:'Make changes visible.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(calls).toEqual([]);expect(await page.locator('.nh-page').innerText()).not.toMatch(/[↗↑]/u);
 await page.screenshot({path:info.outputPath(`homepage-${width}.png`),fullPage:true,animations:'disabled'});
 await page.getByRole('link',{name:'Explore the proof'}).click();await expect(page).toHaveURL(/\/verify$/);await expect(page.getByText('Local digest matches receipt',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Noxicon home'}).click();await expect(page).toHaveURL('/');
});
