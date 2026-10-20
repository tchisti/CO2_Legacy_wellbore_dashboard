import path from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURE = path.join(__dirname, 'fixtures', 'fort-sask.project.json');

test('first run: create project, set profile, land on Portfolio', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible()
  await page.getByLabel('Project name').fill('Test AOR')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByLabel('Your name').fill('T. Chisti'); await page.getByLabel('Initials').fill('TC')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page).toHaveURL(/\/portfolio/)
  // The array form of toContainText matches one element per entry, so it is applied to the nav's links
  // (the brief's `getByRole('navigation')` resolves to the single <nav>, which can only match one entry).
  await expect(page.getByRole('navigation').getByRole('link')).toContainText(['Portfolio', 'Wells', 'Methodology', 'Project settings'])
  await expect(page.getByRole('button', { name: /TC/ })).toBeVisible()
})

test('first run: import a project file', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible()
  await page.getByLabel('Import project file').setInputFiles(FIXTURE)
  await expect(page.getByText('5 wells imported')).toBeVisible()
  await page.getByLabel('Your name').fill('T. Chisti'); await page.getByLabel('Initials').fill('TC')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page).toHaveURL(/\/portfolio/)
  await expect(page.getByRole('button', { name: /Fort Saskatchewan \/ Wabamun Hub AOR/ })).toBeVisible()
})
