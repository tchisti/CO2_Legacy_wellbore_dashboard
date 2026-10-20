import { expect, test, type Page } from '@playwright/test';

/** Opens the app, creates a project (and a profile) through the e2e hook, and lands on Portfolio. */
async function seed(page: Page, { profile = true }: { profile?: boolean } = {}) {
  await page.goto('/');
  await page.waitForFunction(() => window.__lwa !== undefined);
  await page.evaluate(async (withProfile) => {
    const { store } = window.__lwa!;
    await store.projects.create({ name: 'Test AOR' });
    if (withProfile) await store.profile.set({ name: 'T. Chisti', initials: 'TC' });
  }, profile);
  await page.goto('/portfolio');
  // Without a profile the required profile dialog is up, and the page behind it is hidden from the accessibility tree.
  if (profile) await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
}

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'light');

test.describe('theme', () => {
  test.use({ colorScheme: 'dark' });

  test('is light by default even when the OS prefers dark', async ({ page }) => {
    await seed(page);
    expect(await themeOf(page)).toBe('light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(247, 248, 249)');
  });

  test('dark is chosen in the profile menu and survives a reload', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: /TC/ }).click();
    await page.getByRole('menuitem', { name: 'Dark theme' }).click();
    expect(await themeOf(page)).toBe('dark');

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await themeOf(page)).toBe('dark');
    await page.getByRole('button', { name: /TC/ }).click();
    await page.getByRole('menuitem', { name: 'Light theme' }).click();
    expect(await themeOf(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('lwa.theme'))).toBe('light');
  });
});

test('the reviewer profile is required before working, and can be edited later', async ({ page }) => {
  await seed(page, { profile: false });
  const dialog = page.getByRole('dialog', { name: 'Set up your reviewer profile' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.getByLabel('Your name').fill('T. Chisti');
  await page.getByLabel('Initials').fill('tc');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: /TC/ }).click();
  await page.getByRole('menuitem', { name: 'Edit profile' }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('T. Chisti');
  await page.getByLabel('Initials').fill('TCH');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: /TCH/ })).toBeVisible();
});

test('new projects come from the project switcher, which also switches between them', async ({ page }) => {
  await seed(page);
  const switcher = () => page.getByRole('button', { name: /^Project / });
  await expect(switcher()).toHaveText(/Test AOR/);

  await switcher().click();
  await page.getByRole('menuitem', { name: 'New project…' }).click();
  await page.getByLabel('Project name').fill('Second AOR');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(switcher()).toHaveText(/Second AOR/);
  await expect(page.getByText('Project “Second AOR” created')).toBeVisible();

  await switcher().click();
  await page.getByRole('menuitemradio', { name: 'Test AOR' }).click();
  await expect(switcher()).toHaveText(/Test AOR/);
  await page.reload();
  await expect(switcher()).toHaveText(/Test AOR/);
});

test('the sections are reachable from the keyboard and mark the current page', async ({ page }) => {
  await seed(page);
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Wells' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/wells$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Wells' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Wells' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Portfolio' })).not.toHaveAttribute('aria-current', 'page');
});
