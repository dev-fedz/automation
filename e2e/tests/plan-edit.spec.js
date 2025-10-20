const { test, expect } = require('@playwright/test');

// This test requires the dev server to be running and accessible at E2E_BASE_URL or localhost:8000
// It will log in using a test account created in the Django DB (the test runner should provide a user)

test.describe('Test Plan edit flow', () => {
    test('opens plan edit modal and Link Risk modal', async ({ page }) => {
        // adjust base URL via env E2E_BASE_URL if needed
        await page.goto('/');

        // login helper (adjust selectors to your auth UI)
        // This assumes the app provides a simple login form at /accounts/login/
        await page.goto('/accounts/login/');
        await page.fill('input[name="username"]', 'tester');
        await page.fill('input[name="password"]', 'pw');
        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle');

        // navigate to Test Plans
        await page.goto('/automation/test-plans/');
        await page.waitForSelector('[data-role="plan-list"]');

        // ensure at least one plan exists - if not, create one via API
        const plans = await page.$$('[data-role="plan-list"] tr[data-plan-id]');
        if (!plans.length) {
            // create via API using fetch in page context
            await page.evaluate(async () => {
                await fetch('/api/core/test-plans/', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'E2E Plan', description: 'Created by e2e' }),
                });
            });
            await page.reload();
            await page.waitForSelector('[data-role="plan-list"] tr[data-plan-id]');
        }

        // click Edit on the first plan row
        await page.click('[data-action="edit-plan"]');

        // modal should open
        await expect(page.locator('[data-role="plan-modal"]')).toBeVisible();

        // click Link Risk button in step 4 after advancing steps
        // advance to step 4 (click Next until it shows step 4)
        for (let i = 0; i < 4; i++) {
            await page.click('#plan-submit');
            await page.waitForTimeout(300);
        }

        // open mapping modal
        await page.click('[data-action="open-mapping-modal"]');
        await expect(page.locator('[data-role="mapping-modal"]')).toBeVisible();

        // close modal
        await page.click('[data-action="close-mapping-modal"]');
        await expect(page.locator('[data-role="mapping-modal"]')).toBeHidden();
    });
});
