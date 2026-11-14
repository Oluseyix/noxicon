import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
 ...base,
 use:{...base.use,baseURL:'http://127.0.0.1:3101'},
 webServer:{command:'npm run start -- --hostname 127.0.0.1 --port 3101',url:'http://127.0.0.1:3101',timeout:60000,reuseExistingServer:false},
});
