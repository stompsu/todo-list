import { expect, test, type Page } from '@playwright/test';

type Board = {
  version: 1;
  categories: { id: string; name: string }[];
  tasks: { id: string; title: string; description: string; categoryId: string | null; color: string; status: string }[];
};

async function mockBoardApi(page: Page) {
  let board: Board = { version: 1, categories: [], tasks: [] };
  let version = 1;
  await page.route('**/api/board', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: `"v${version}"` }, body: JSON.stringify(board) });
      return;
    }
    if (request.headers()['if-match'] !== `"v${version}"`) {
      await route.fulfill({ status: 412, contentType: 'application/json', body: JSON.stringify({ message: 'stale' }) });
      return;
    }
    board = request.postDataJSON() as Board;
    version += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: `"v${version}"` }, body: JSON.stringify(board) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockBoardApi(page);
});

test('creates a categorized colored task, moves it by status selector, and persists after reload', async ({ page }) => {
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
  let task = page.locator('article').filter({ hasText: 'Plan weekend' });
  await expect(task).toBeVisible();
  await task.getByLabel('Status for Plan weekend').selectOption('in-progress');
  await expect(task.getByLabel('Status for Plan weekend')).toHaveValue('in-progress');
  await page.reload();
  task = page.locator('article').filter({ hasText: 'Plan weekend' });
  await expect(task).toBeVisible();
  await expect(task.getByLabel('Status for Plan weekend')).toHaveValue('in-progress');
  await expect(task).toContainText('Personal');
});

test('supports pointer drag into an empty status column, including on mobile', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add task' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByLabel('Title').fill('Move me');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Add task' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByLabel('Title').fill('Neighbor');
  await dialog.getByRole('button', { name: 'Add task' }).click();

  const handle = page.locator('article').filter({ hasText: 'Move me' }).getByRole('button', { name: 'Reorder Move me' }).first();
  const targetColumn = page.locator('[data-status="completed"]');
  const from = await handle.boundingBox();
  const to = await targetColumn.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 60, { steps: 12 });
  await page.mouse.up();
  const movedTask = page.locator('article').filter({ hasText: 'Move me' });
  await expect(movedTask.getByLabel('Status for Move me')).toHaveValue('completed');
  expect(testInfo.project.use.viewport).toBeDefined();
});

test('supports touch pointer reorder on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Touch-specific drag is verified in mobile Chromium.');
  await page.goto('/');
  for (const title of ['Touch first', 'Touch second']) {
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a task' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Add task' }).click();
  }
  const first = page.locator('article').filter({ hasText: 'Touch first' });
  const second = page.locator('article').filter({ hasText: 'Touch second' });
  const handleBox = await first.getByRole('button', { name: 'Reorder Touch first' }).boundingBox();
  const targetBox = await second.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const x = handleBox!.x + handleBox!.width / 2;
  const y = handleBox!.y + handleBox!.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  for (let step = 1; step <= 8; step += 1) {
    const moveX = x + ((targetBox!.x + targetBox!.width / 2 - x) * step) / 8;
    const moveY = y + ((targetBox!.y + targetBox!.height / 2 - y) * step) / 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: moveX, y: moveY, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('[data-status="todo"] article h3').nth(0)).toHaveText('Touch second');
});

test('supports keyboard sorting and cancellation without mutation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Keyboard coordinate sorting is covered on desktop; mobile drag is covered separately.');
  await page.goto('/');
  for (const title of ['First task', 'Second task']) {
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a task' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Add task' }).click();
  }
  const handle = page.locator('article').filter({ hasText: 'First task' }).getByRole('button', { name: 'Reorder First task' }).first();
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  const tasks = page.locator('[data-status="todo"] article h3');
  await expect(tasks.nth(0)).toHaveText('First task');
  await expect(tasks.nth(1)).toHaveText('Second task');
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  const preview = page.getByText('First task', { exact: true }).last();
  const before = await preview.boundingBox();
  expect(before).not.toBeNull();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await preview.boundingBox())?.y).toBeGreaterThan(before!.y);
  await page.keyboard.press('Space');
  await expect(tasks.nth(1)).toHaveText('First task');
});

test('validates import and requires confirmation before replacing the shared board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add task' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'Add a task' });
  await taskDialog.getByLabel('Title').fill('Current task');
  await taskDialog.getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('Choose a ToDo board JSON file').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid'),
  });
  await expect(page.getByRole('alert')).toContainText('The file is not valid JSON.');
  await expect(page.getByText('Current task')).toBeVisible();
  const replacement = {
    version: 1, categories: [], tasks: [{
      id: 'imported-task', title: 'Imported task', description: '', categoryId: null,
      color: '#315eb8', status: 'todo',
    }],
  };
  const confirm = page.waitForEvent('dialog');
  await page.getByLabel('Choose a ToDo board JSON file').setInputFiles({
    name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)),
  });
  const confirmation = await confirm;
  expect(confirmation.message()).toContain('Replace all current tasks and categories on the shared board');
  await confirmation.accept();
  await expect(page.getByText('Imported task')).toBeVisible();
  await expect(page.getByText('Current task')).toHaveCount(0);
});

test('keeps task board within the mobile and desktop viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const name of ['To Do', 'In Progress', 'Completed']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const board = page.getByRole('region', { name: 'Task board' });
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
});
