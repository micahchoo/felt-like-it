import { test as base, type Page } from '@playwright/test';

/**
 * Fixture that provides an authenticated page.
 * Creates a unique user per test run via signup, or logs in if the user already exists.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    const email = `e2e-${Date.now()}@test.local`;
    const password = 'testpass123';
    const name = 'E2E User';

    // Try signup first
    await page.goto('/auth/signup');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Should redirect to dashboard
    await page.waitForURL('**/dashboard');

    await use(page);
  },
});

/**
 * Fixture that logs in as the seeded demo user.
 */
export const demoTest = base.extend<{ demoPage: Page }>({
  demoPage: async ({ page }, use) => {
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('demo@felt-like-it.local');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');

    await use(page);
  },
});

export { expect } from '@playwright/test';
