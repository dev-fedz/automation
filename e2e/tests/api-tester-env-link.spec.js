const { test, expect } = require('@playwright/test');

async function expectOk(resp, label) {
    if (resp.ok()) return;
    let bodyText = '';
    try {
        bodyText = await resp.text();
    } catch (e) {
        bodyText = `<unable to read body: ${String(e)}>`;
    }
    throw new Error(`${label} failed: status=${resp.status()} url=${resp.url()} body=${bodyText}`);
}

async function login(page) {
    await page.goto('/login/');
    await page.fill('input[name="email"]', 'tester@example.com');
    await page.fill('input[name="password"]', 'pw');

    // The login form is intercepted by web/static/js/app.js and posts to
    // /api/accounts/auth/login/ then redirects to /dashboard/.
    await page.click('#login-form button[type="submit"]');
    // /dashboard/ is a redirect to the dashboard route ('/').
    await page.waitForURL((url) => {
        const path = url.pathname;
        return path === '/' || path === '/dashboard/' || path === '/dashboard';
    }, { timeout: 15000 });
}

test.describe('API Tester', () => {
    test('links selected environment to active collection', async ({ page }) => {
        await login(page);

        const token = await page.evaluate(() => window.localStorage.getItem('authToken'));
        expect(token).toBeTruthy();

        const nonce = Date.now();
        const envName = `E2E Env Link Environment ${nonce}`;
        const collectionName = `E2E Env Link Collection ${nonce}`;

        const authHeaders = {
            Authorization: `Token ${token}`,
        };

        const envCreate = await page.request.post('/api/core/environments/', {
            headers: authHeaders,
            data: {
                name: envName,
                description: 'Created by Playwright',
                variables: { base_url: 'https://example.invalid' },
                default_headers: { 'X-E2E': '1' },
            },
        });
        await expectOk(envCreate, 'Create environment');
        const env = await envCreate.json();
        expect(env && env.id).toBeTruthy();

        const collectionCreate = await page.request.post('/api/core/collections/', {
            headers: authHeaders,
            data: {
                name: collectionName,
                description: 'Created by Playwright',
                requests: [],
                environment_ids: [],
            },
        });
        await expectOk(collectionCreate, 'Create collection');
        const collection = await collectionCreate.json();
        expect(collection && collection.id).toBeTruthy();

        await page.goto('/automation/api-tester/');
        await page.waitForSelector('#api-tester-app');

        // Select the newly created collection.
        const collectionCard = page.locator('.collection-card', { hasText: collectionName });
        await expect(collectionCard).toBeVisible({ timeout: 15000 });
        await collectionCard.click();

        // Wait until the new environment appears as an option in the Request Builder dropdown.
        const envSelect = page.locator('#environment-select');
        await expect(envSelect).toBeVisible();
        await expect(envSelect.locator(`option[value="${env.id}"]`)).toHaveCount(1);

        const patchResponsePromise = page.waitForResponse((resp) => {
            const req = resp.request();
            return (
                req.method() === 'PATCH' &&
                resp.url().includes(`/api/core/collections/${collection.id}/`) &&
                resp.status() < 400
            );
        });

        await envSelect.selectOption(String(env.id));

        // Our fix should PATCH the active collection to add environment_ids.
        await patchResponsePromise;

        // Reload and confirm the environment is shown as linked.
        await page.reload();
        await page.waitForSelector('#api-tester-app');
        const collectionCardAfterReload = page.locator('.collection-card', { hasText: collectionName });
        await expect(collectionCardAfterReload).toBeVisible({ timeout: 15000 });
        await collectionCardAfterReload.click();

        const linkedOption = page.locator(`#environment-select option[value="${env.id}"]`);
        await expect(linkedOption).toContainText('(linked)');
        await expect(page.locator('.env-pill', { hasText: envName })).toBeVisible();
    });
});
