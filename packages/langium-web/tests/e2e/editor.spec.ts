import { test, expect } from '@playwright/test';

test('Monaco editor mounts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
});

test('valid code produces no error squiggles', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: 20_000 });
    // Wait for language server to settle — zero squiggles means LS connected and validated OK
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
});

test('syntax error produces diagnostic squiggle(s)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: 20_000 });
    // Wait for LS to clear initial diagnostics before we type
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });

    // Replace all content with invalid arithmetic code (missing RHS expression)
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Module bad\ndef a: ;');

    // At least one error squiggle should appear
    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 10_000 });
});
