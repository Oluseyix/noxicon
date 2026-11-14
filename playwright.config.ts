import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  // Rendering-budget and full-page screenshot checks share the host GPU.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: { command: 'npm run dev -- --hostname 127.0.0.1 --port 3100', url: 'http://127.0.0.1:3100', timeout: 60000, reuseExistingServer: true, env: { VEYRA_DIST_DIR: '.next-browser' } },
  projects: [{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'mobile',use:{viewport:{width:375,height:812}}}],
});
