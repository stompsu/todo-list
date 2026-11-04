import { expect, test } from '@playwright/test';

test('creates a categorized colored task, moves it, and persists edits after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ToDo Board' })).toBeVisible();

  await page.getByText('Manage categories').click();
  await page.getByLabel('New category name').fill('Personal');
  await page.getByRole('button', { name: 'Add category' }).click();

  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByLabel('Title').fill('Plan weekend');
  await dialog.getByLabel('Description Optional').fill('Book a table');
  await dialog.getByLabel('Category Optional').selectOption({ label: 'Personal' });
  await dialog.getByLabel('Task color').fill('#21a179');
  await dialog.getByRole('button', { name: 'Add task' }).click();

  const task = page.locator('article').filter({ hasText: 'Plan weekend' });
  await expect(task).toBeVisible();
  await task.getByLabel('Status for Plan weekend').selectOption('in-progress');
  await expect(task.getByLabel('Status for Plan weekend')).toHaveValue('in-progress');

  await page.reload();
  const restoredTask = page.locator('article').filter({ hasText: 'Plan weekend' });
  await expect(restoredTask).toBeVisible();
  await expect(restoredTask.getByLabel('Status for Plan weekend')).toHaveValue('in-progress');
  await expect(restoredTask).toContainText('Personal');
  await expect(restoredTask.locator('[aria-hidden="true"]').first()).toHaveCSS('background-color', 'rgb(33, 161, 121)');
  await restoredTask.getByRole('button', { name: 'Delete Plan weekend' }).click();
  await expect(page.locator('article').filter({ hasText: 'Plan weekend' })).toHaveCount(0);
});

test('keeps all three status columns usable at the current viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const name of ['To Do', 'In Progress', 'Completed']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const board = page.getByRole('region', { name: 'Task board' });
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  if (testInfo.project.name === 'mobile-chromium') {
    expect(box!.width).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  }
});

test('exports JSON and validates and confirms replacement imports', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add task' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'Add a task' });
  await taskDialog.getByLabel('Title').fill('Current task');
  await taskDialog.getByRole('button', { name: 'Add task' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('todo-board.json');

  await page.getByLabel('Choose a ToDo board JSON file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{invalid'),
  });
  await expect(page.getByRole('alert')).toContainText('The file is not valid JSON.');
  await expect(page.getByText('Current task')).toBeVisible();

  const replacement = {
    version: 1,
    categories: [],
    tasks: [{
      id: 'imported-task',
      title: 'Imported task',
      description: '',
      categoryId: null,
      color: '#315eb8',
      status: 'todo',
    }],
  };
  const confirmationPromise = page.waitForEvent('dialog');
  await page.getByLabel('Choose a ToDo board JSON file').setInputFiles({
    name: 'board.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  const confirmation = await confirmationPromise;
  expect(confirmation.message()).toContain('Replace all current tasks and categories');
  await confirmation.accept();

  await expect(page.getByText('Imported task')).toBeVisible();
  await expect(page.getByText('Current task')).toHaveCount(0);
});
