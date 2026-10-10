import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',timeout:60000,expect:{timeout:10000},workers:1,fullyParallel:false,retries:0,
  reporter:'list',outputDir:'output/playwright/results',
  use:{baseURL:process.env.E2E_BASE_URL,headless:true,actionTimeout:15000,navigationTimeout:20000,trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium',use:{browserName:'chromium',viewport:{width:1440,height:1000}}}]
});
