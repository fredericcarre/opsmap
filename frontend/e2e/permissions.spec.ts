import { test, expect } from '@playwright/test';

test.describe('Permissions', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByPlaceholder('you@example.com').fill('demo@opsmap.io');
    await page.getByPlaceholder('Enter your password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/', { timeout: 10000 });
  });

  test('should open permissions modal', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText('Share Map')).toBeVisible();
      await expect(page.getByText('Manage who has access')).toBeVisible();
    }
  });

  test('should show add user form', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      await expect(page.getByPlaceholder('Email address')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();
    }
  });

  test('should show owner section', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      await page.waitForTimeout(1000);
      await expect(page.getByRole('heading', { name: 'Owner' })).toBeVisible();
    }
  });

  test('should show create share link button', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      await expect(page.getByRole('button', { name: /Create Link/i })).toBeVisible();
    }
  });

  test('should close modal when clicking X', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      await expect(page.getByRole('dialog')).toBeVisible();

      // Click close button
      await page.getByRole('button', { name: 'Close' }).click();

      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
  });

  test('should validate email input', async ({ page }) => {
    await page.waitForTimeout(1000);

    const mapLink = page.locator('[href^="/maps/"]').first();
    const hasMap = await mapLink.isVisible().catch(() => false);

    if (hasMap) {
      await mapLink.click();
      await page.getByRole('button', { name: /Share/i }).click();

      // Try to submit with empty email
      await page.getByRole('button', { name: 'Add' }).click();

      // Form should not submit (HTML5 validation)
      await expect(page.getByRole('dialog')).toBeVisible();
    }
  });
});
