import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('signup creates account and redirects to dashboard', async ({ page }) => {
    const email = `e2e-signup-${Date.now()}@test.local`;
    await page.goto('/auth/signup');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('testpass123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    // Verify the user email is displayed in the nav
    await expect(page.getByText(email)).toBeVisible();

    // Verify the user actually reached the dashboard (dashboard-specific heading)
    await expect(page.getByRole('heading', { name: 'Your Maps' })).toBeVisible();
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('demo@felt-like-it.local');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByText('demo@felt-like-it.local')).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('rejects duplicate email signup', async ({ page }) => {
    const email = `e2e-dup-${Date.now()}@test.local`;
    const password = 'testpass123';

    // First signup succeeds
    await page.goto('/auth/signup');
    await page.getByLabel('Name').fill('First User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    // Log out (navigate to signup again to try duplicate)
    await page.goto('/auth/signup');
    await page.getByLabel('Name').fill('Second User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Should show an error about the duplicate email, not redirect to dashboard
    await expect(page.getByRole('alert')).toContainText(/already exists/i);
    await expect(page).toHaveURL(/\/auth\/signup/);
  });

  test('rejects weak password under 8 characters', async ({ page }) => {
    await page.goto('/auth/signup');
    await page.getByLabel('Name').fill('Weak Pass User');
    await page.getByLabel('Email').fill(`e2e-weak-${Date.now()}@test.local`);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Should show a validation error about password length
    await expect(page.getByRole('alert')).toContainText(/at least 8 characters/i);
    await expect(page).toHaveURL(/\/auth\/signup/);
  });
});
