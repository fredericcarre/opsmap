import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByPlaceholder('you@example.com').fill('demo@opsmap.io');
    await page.getByPlaceholder('Enter your password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('should display dashboard', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('View and manage your application maps')).toBeVisible();
  });

  test('should show new map button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'New Map' })).toBeVisible();
  });

  test('should display maps list or empty state', async ({ page }) => {
    // Either shows maps or empty state
    const hasEmptyState = await page.getByText('No maps yet').isVisible().catch(() => false);
    const hasMaps = await page.locator('[href^="/maps/"]').first().isVisible().catch(() => false);

    expect(hasEmptyState || hasMaps).toBeTruthy();
  });

  test('should navigate to map when clicking a map card', async ({ page }) => {
    // Wait for maps to load
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await expect(page).toHaveURL(/\/maps\/.+/);
    }
  });

  test('should show user info in sidebar', async ({ page }) => {
    await expect(page.getByText('demo@opsmap.io')).toBeVisible();
  });

  test('should logout when clicking logout button', async ({ page }) => {
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL('/login');
  });
});
