import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const historical=JSON.parse(readFileSync('evidence/groq-report.json','utf8'));
for(const width of [375,768,1280,1440])test(`report identity, keyboard timeline and expanded evidence at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 await page.route('**/api/benchmarks/models',route=>route.fulfill({json:{models:[],available:false,message:'Report inspection only.'}}));
 await page.goto('/app');
 // A test-only copy exercises wrapping; the historical fixture is never written.
 const report=structuredClone(historical);report.config.model='test-only/'+('long-model-identifier-'.repeat(8));
 await page.getByLabel('Import benchmark report',{exact:true}).setInputFiles({name:'test-report.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
 await expect(page.getByRole('heading',{name:report.config.model,level:2})).toBeVisible();
 await expect(page.locator('.nr-identity')).toHaveText('GroqRun completed');
 await expect(page.locator('.vn-success')).toContainText('100.0%');
 await expect(page.getByText(/1 successful measured request reached the output token limit/)).toBeVisible();
 await expect(page.locator('.vc-metrics strong').first()).toHaveCSS('font-variant-numeric','tabular-nums');
 const row=page.getByRole('button',{name:'View timing for request 1',exact:true});await row.focus();await page.keyboard.press('Enter');
 await expect(row).toHaveAttribute('aria-pressed','true');await expect(page.locator('.vn-chart-selection')).toContainText('356.1 ms');
 for(const label of ['Technical details and individual requests','How to read these measurements','Exact run configuration','Evidence and report fingerprints','Inspect local report fingerprints']){
  const summary=page.getByText(label,{exact:true});await summary.focus();await page.keyboard.press('Enter');
 }
 await expect(page.getByText('Token limit reached (truncated)',{exact:true})).toBeVisible();
 await expect(page.locator('.nr-methodology')).toContainText('not raw GPU decoding speed');
 await expect(page.locator('.vc-hash code')).toHaveCount(3);
 const table=page.getByRole('region',{name:'Request measurements, scroll horizontally'});await table.focus();await expect(table).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('.vn-verification-status')).toContainText('Publication status not checked here.');
});
