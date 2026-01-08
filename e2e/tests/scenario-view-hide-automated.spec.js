const { test, expect } = require('@playwright/test');

async function login(page) {
    await page.goto('/login/');
    await page.fill('input[name="email"]', 'tester@example.com');
    await page.fill('input[name="password"]', 'pw');

    // Login is handled by web/static/js/app.js and should redirect to dashboard.
    await page.click('#login-form button[type="submit"]');
    await page.waitForURL((url) => {
        const path = url.pathname;
        return path === '/' || path === '/dashboard/' || path === '/dashboard';
    }, { timeout: 15000 });
}

test.describe('Scenarios', () => {
    test('hides Automated scenario toggle in View modal', async ({ page }) => {
        let lastScenarioPatchBody = null;
        page.on('request', (req) => {
            try {
                const url = req.url();
                if (req.method() !== 'PATCH') return;
                if (!/\/api\/core\/test-scenarios\//.test(url)) return;
                const raw = req.postData();
                if (!raw) return;
                lastScenarioPatchBody = JSON.parse(raw);
            } catch (e) {
                // ignore
            }
        });

        page.on('dialog', async (dialog) => {
            try { await dialog.accept(); } catch (e) { /* ignore */ }
        });

        await login(page);

        const token = await page.evaluate(() => window.localStorage.getItem('authToken'));
        expect(token).toBeTruthy();

        const authHeaders = {
            Authorization: `Token ${token}`,
        };

        const nonce = Date.now();
        const planName = `E2E Plan Scenarios ${nonce}`;
        const moduleTitle = `E2E Module ${nonce}`;
        const scenarioTitle = `E2E Scenario ${nonce}`;

        // Create plan
        const planCreate = await page.request.post('/api/core/test-plans/', {
            headers: authHeaders,
            data: { name: planName, description: 'Created by Playwright' },
        });
        expect(planCreate.ok()).toBeTruthy();
        const plan = await planCreate.json();
        expect(plan && plan.id).toBeTruthy();

        // Create module (project/plan relationship is exposed as `project` in the UI)
        const moduleCreate = await page.request.post('/api/core/test-modules/', {
            headers: authHeaders,
            data: { title: moduleTitle, description: 'Created by Playwright', project: plan.id },
        });
        expect(moduleCreate.ok()).toBeTruthy();
        const mod = await moduleCreate.json();
        expect(mod && mod.id).toBeTruthy();

        // Create scenario
        const scenarioCreate = await page.request.post('/api/core/test-scenarios/', {
            headers: authHeaders,
            data: {
                module: mod.id,
                project: plan.id,
                title: scenarioTitle,
                description: '<p>One</p><ol><li><p>Two</p></li></ol>',
                is_automated: true,
            },
        });
        expect(scenarioCreate.ok()).toBeTruthy();
        const scenario = await scenarioCreate.json();
        expect(scenario && scenario.id).toBeTruthy();

        // Create a comment for the scenario (should appear in View Scenario below description).
        const commentText = `E2E Comment ${nonce}`;
        const commentCreate = await page.request.post('/api/core/scenario-comments/', {
            headers: authHeaders,
            data: { scenario: scenario.id, content: `<p>${commentText}</p>` },
        });
        expect(commentCreate.ok()).toBeTruthy();

        // Open Scenarios page.
        await page.goto('/automation/test-scenarios/');

        // Select the newly created project so the scenarios table is populated.
        const projectSelect = page.locator('#scenario-plan');
        await expect(projectSelect).toBeVisible({ timeout: 15000 });
        await expect(projectSelect.locator(`option[value="${plan.id}"]`)).toHaveCount(1, { timeout: 15000 });
        await projectSelect.selectOption(String(plan.id));

        // Wait for the scenario row to render.
        const viewBtn = page.locator(`[data-action="view-scenario"][data-scenario-id="${scenario.id}"]`);
        await expect(viewBtn).toBeVisible({ timeout: 15000 });

        // Ensure data_management.js has registered the shared modal helper.
        await page.waitForFunction(() => typeof window.openModuleScenarioModal === 'function', null, { timeout: 15000 });

        await viewBtn.click();

        const modal = page.locator('[data-role="module-add-scenario-modal"]');
        await expect(modal).toBeVisible({ timeout: 15000 });

        const header = modal.locator('#module-add-scenario-modal-title');
        await expect(header).toHaveText('View Scenario');

        // Comments should appear below the description in View Scenario.
        const commentsRow = modal.locator('#module-view-scenario-comments-row');
        const commentsContainer = modal.locator('#module-view-scenario-comments');
        await expect(commentsRow).toBeVisible({ timeout: 15000 });
        await expect(commentsContainer).toContainText(commentText, { timeout: 15000 });

        // Add Comment button should show the inline composer (TinyMCE + Post + Cancel).
        const addCommentBtn = modal.locator('[data-action="toggle-view-scenario-add-comment"]');
        await expect(addCommentBtn).toBeVisible();
        await addCommentBtn.click();

        const addCommentForm = modal.locator('#module-view-scenario-add-comment-form');
        await expect(addCommentForm).toBeVisible({ timeout: 15000 });

        // TinyMCE should initialize for the comment composer.
        await expect(page.locator('#module-view-scenario-comment-content_ifr')).toHaveCount(1, { timeout: 15000 });

        const newCommentText = `E2E Inline Comment ${nonce}`;
        const commentIframe = page.frameLocator('#module-view-scenario-comment-content_ifr');
        const commentBody = commentIframe.locator('body');
        await expect(commentBody).toBeVisible({ timeout: 15000 });
        await commentBody.click();
        await commentBody.type(newCommentText);

        // Post and verify it appears below the description.
        await addCommentForm.locator('[data-action="post-view-scenario-add-comment"]').click();
        await expect(commentsContainer).toContainText(newCommentText, { timeout: 15000 });
        await expect(addCommentForm).toBeHidden({ timeout: 15000 });

        // The automated toggle row should not be shown in view mode.
        const automatedRow = modal.locator('.form-row.dependency-toggle');
        await expect(automatedRow).toBeHidden();

        // Description textarea should be at least 12 rows tall.
        const desc = modal.locator('#module-add-scenario-description');
        await expect(desc).toBeVisible();
        await expect(desc).toHaveAttribute('rows', '12');
        const box = await desc.boundingBox();
        expect(box && box.height).toBeTruthy();
        expect(box.height).toBeGreaterThanOrEqual(180);

        // Clicking the description in View mode should promote to Edit mode
        // UI should remain "View Scenario", but TinyMCE should appear for description.
        await desc.click();
        await expect(modal.locator('.tox-tinymce')).toHaveCount(1);
        await expect(page.locator('#module-add-scenario-description_ifr')).toHaveCount(1);

        await expect(header).toHaveText('View Scenario');
        await expect(automatedRow).toBeHidden();

        const saveBtn = modal.locator('button[type="submit"]');
        await expect(saveBtn).toBeVisible();

        // Change content via TinyMCE like a real user (type into the iframe) and save.
        const updatedText = `Updated ${Date.now()}`;
        const iframe = page.frameLocator('#module-add-scenario-description_ifr');
        const body = iframe.locator('body');
        await expect(body).toBeVisible({ timeout: 15000 });
        await body.click();

        // Use actual keystrokes so TinyMCE updates its internal model.
        await body.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await body.type(updatedText);

        // Ensure TinyMCE reflects the new content before saving.
        await expect
            .poll(
                async () => {
                    return page.evaluate(() => {
                        const ed = window.tinymce && window.tinymce.get && window.tinymce.get('module-add-scenario-description');
                        if (!ed) return null;
                        return ed.getContent({ format: 'text' });
                    });
                },
                { timeout: 15000 }
            )
            .toContain(updatedText);

        await saveBtn.click();

        // Ensure we actually sent the updated description to the API.
        await expect
            .poll(() => lastScenarioPatchBody, { timeout: 15000 })
            .not.toBeNull();
        expect(String(lastScenarioPatchBody.description || '')).toContain(updatedText);

        // Modal should remain open.
        await expect(modal).toBeVisible();
        await expect(header).toHaveText('View Scenario');

        // TinyMCE should be torn down and we should be back to textarea view.
        await expect(modal.locator('.tox-tinymce')).toHaveCount(0, { timeout: 15000 });
        await expect(page.locator('#module-add-scenario-description_ifr')).toHaveCount(0, { timeout: 15000 });
        await expect(desc).toHaveValue(new RegExp(updatedText), { timeout: 15000 });
    });
});
