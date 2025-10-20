Playwright E2E tests

Setup

1. Ensure node.js (16+) is installed.
2. From the project root install dev deps:

   npm install

3. Install Playwright browser binaries:

   npx playwright install

Running tests

- Run headless: npm run test:e2e
- Run headed: npm run test:e2e:headed
- Run debug: npm run test:e2e:debug

Configuration

- Edit `playwright.config.js` to change `baseURL` or set environment `E2E_BASE_URL`.
- Tests assume a test user exists (username `tester`, password `pw`). Create this user in your DB before running tests or extend tests to create UI users via admin API.
