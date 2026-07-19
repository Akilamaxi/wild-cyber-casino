import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Cyber Casino E2E test suite.
 *
 * Run all tests:       npx playwright test
 * Run a single spec:   npx playwright test tests/playwright/04-slots.spec.ts
 * Show HTML report:    npx playwright show-report
 * UI mode:             npx playwright test --ui
 */
export default defineConfig({
  // Root directory for test discovery
  testDir: './tests/playwright',

  // Match files with .spec.ts extension
  testMatch: '**/*.spec.ts',

  // Max parallel workers (set to 1 for sequential DB safety)
  workers: 1,

  // Fail the build on any test failure
  forbidOnly: !!process.env.CI,

  // Retry failing tests once in CI
  retries: process.env.CI ? 1 : 0,

  // Shared settings for every test
  use: {
    // Base URL (frontend dev server)
    baseURL: 'http://localhost:3000',

    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Capture video on first retry
    video: 'retain-on-failure',

    // Capture trace on first retry for debugging
    trace: 'retain-on-failure',

    // Viewport
    viewport: { width: 1440, height: 900 },

    // Ignore HTTPS cert errors if any
    ignoreHTTPSErrors: true,

    // Default action timeout
    actionTimeout: 10_000,

    // Navigation timeout
    navigationTimeout: 20_000,
  },

  // Output directory for test results and artifacts
  outputDir: 'tests/playwright/test-results',

  // HTML Report
  reporter: [
    ['html', { outputFolder: 'tests/playwright/playwright-report', open: 'never' }],
    ['list'],
  ],

  // Projects define browsers / environments
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    // Mobile viewport smoke pass
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
});
