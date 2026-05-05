import { test, expect, type Page } from '@playwright/test';

const READY_TIMEOUT = 20_000;

const focusEditor = async (page: Page): Promise<void> => {
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    await page.locator('.monaco-editor').first().click();
};

const replaceContent = async (page: Page, text: string): Promise<void> => {
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type(text);
};

const cursorTopPx = async (page: Page): Promise<string | null> => {
    return page.evaluate(() => {
        const cursor = document.querySelector('.cursors-layer .cursor');
        return cursor ? (cursor as HTMLElement).style.top || (cursor as HTMLElement).style.transform : null;
    });
};

test('Monaco editor mounts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: READY_TIMEOUT });
});

test('valid code produces no error squiggles', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    // Wait for language server to settle — zero squiggles means LS connected and validated OK
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });
});

test('syntax error produces diagnostic squiggle(s)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    // Wait for LS to clear initial diagnostics before we type
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });

    // Replace all content with invalid arithmetic code (missing RHS expression)
    await replaceContent(page, 'Module bad\ndef a: ;');

    // At least one error squiggle should appear
    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 10_000 });
});

test('parse-error diagnostic appears within 10 seconds of typing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });

    await replaceContent(page, 'Module bad\ndef a: ;');

    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 10_000 });
});

test('cross-reference diagnostic for an undefined name', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });

    // 'b' is referenced but never defined — LS should flag the unresolved reference
    await replaceContent(page, 'Module m\ndef a: b;');

    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 10_000 });
});

test('go-to-definition jumps cursor to the declaration', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });

    // Initial code declares 'a' on line 3 and references it on line 5: "def c: a + b;"
    // Position cursor on 'a' at line 5 col 8 via Monaco's Go-to-Line widget.
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+G');
    await page.keyboard.type('5:8');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const before = await cursorTopPx(page);
    expect(before).toBeTruthy();

    // F12 — Go to Definition
    await page.keyboard.press('F12');

    // Cursor should move to a different line (the declaration of 'a' on line 3)
    await expect.poll(() => cursorTopPx(page), { timeout: 10_000 }).not.toBe(before);
});

test('document symbols action lists declared names', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });

    await focusEditor(page);
    // Ctrl/Cmd+Shift+O → Go to Symbol in Editor (Monaco quick-pick)
    await page.keyboard.press('ControlOrMeta+Shift+O');

    const widget = page.locator('.quick-input-widget');
    await expect(widget).toBeVisible({ timeout: 10_000 });

    // The initial code declares definitions named a, b, c — at least one should appear
    await expect(widget).toContainText(/\b[abc]\b/, { timeout: 10_000 });
});

test('folding ranges produce gutter widgets for multi-line content', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.monaco-editor', { timeout: READY_TIMEOUT });
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: READY_TIMEOUT });

    // Replace with a multi-line block-comment that spans multiple lines —
    // Langium's default folding-range provider always emits a fold for these.
    await replaceContent(page, 'Module m\n\n/*\n  multi\n  line\n*/\ndef a: 1;');

    // Hover the editor so the gutter renders fold widgets (Monaco shows them on hover by default).
    await page.locator('.monaco-editor').first().hover();

    // Expanded folding chevron icon — appears for any foldable range in the document.
    const foldIcon = page.locator('.codicon-folding-expanded, .codicon-folding-collapsed').first();
    await expect(foldIcon).toBeAttached({ timeout: 10_000 });
});
