// Playwright config for automation project
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'e2e/tests',
    timeout: 30 * 1000,
    expect: { timeout: 5000 },
    fullyParallel: true,
    use: {
        headless: true,
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:8000',
        actionTimeout: 10 * 1000,
        trace: 'on-first-retry',
    },
});
