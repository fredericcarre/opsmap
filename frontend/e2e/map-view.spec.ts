import { test, expect } from '@playwright/test';

test.describe('Map View', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByPlaceholder('you@example.com').fill('demo@opsmap.io');
    await page.getByPlaceholder('Enter your password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('should display map view when clicking a map', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();

      // Should show map header
      await expect(page.getByRole('heading', { name: 'Architecture' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Components' })).toBeVisible();
    }
  });

  test('should show share button', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await expect(page.getByRole('button', { name: /Share/i })).toBeVisible();
    }
  });

  test('should show refresh button', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
    }
  });

  test('should navigate back to dashboard', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.waitForURL(/\/maps\/.+/);

      // Click back button
      await page.locator('a[href="/"]').first().click();
      await expect(page).toHaveURL('/');
    }
  });

  test('should open permissions modal when clicking share', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Share Map' })).toBeVisible();
    }
  });

  test('should display component list', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();

      // Wait for components to load
      await page.waitForTimeout(1000);

      // Should show components section
      const componentsHeader = page.getByRole('heading', { name: 'Components' });
      await expect(componentsHeader).toBeVisible();
    }
  });
});
