import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { BoardData } from '../../src/types/board';

// Only the desktop integration project runs this file, in one worker. Never mock
// board responses: browser and request traffic both go through the Vite proxy.
test.describe.configure({ mode: 'default', timeout: 30_000 });

const emptyBoard: BoardData = { version: 1, categories: [], tasks: [] };

async function readBoard(request: APIRequestContext) {
  const response = await request.get('/api/board');
  expect(response.status()).toBe(200);
  const etag = response.headers().etag;
  expect(etag).toBeTruthy();
  return { board: await response.json() as BoardData, etag };
}

async function replaceBoard(request: APIRequestContext, board: BoardData) {
  const current = await readBoard(request);
  const response = await request.put('/api/board', {
    headers: { 'If-Match': current.etag }, data: board,
  });
  expect(response.status()).toBe(200);
  expect(response.headers().etag).toBeTruthy();
  expect(response.headers().etag).not.toBe(current.etag);
  expect(await response.json()).toEqual(board);
}

async function saved(page: Page, action: () => Promise<unknown>) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/board') && response.request().method() === 'PUT', { timeout: 10_000 });
  await action();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers().etag).toBeTruthy();
  await expect(page.getByText('Changes saved to the shared board.', { exact: true })).toBeVisible();
}

async function openBoard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeEnabled();
}

async function addTask(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await saved(page, () => dialog.getByRole('button', { name: 'Add task' }).click());
}

async function downloadText(page: Page, button: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test.beforeEach(async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'healthy' });
  await replaceBoard(request, emptyBoard);
});

test('real API persists task CRUD, category rename/color and category deletion without losing tasks', async ({ page, request }) => {
  await openBoard(page);
  await page.getByText('Manage categories').click();
  await page.getByLabel('New category name').fill('Personal');
  await saved(page, () => page.getByRole('button', { name: 'Add category' }).click());
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  await expect(dialog.getByLabel('Title', { exact: true })).toBeFocused();
  await dialog.getByLabel('Title', { exact: true }).fill('Plan weekend');
  await dialog.getByLabel('Description Optional').fill('Book a table');
  await dialog.getByLabel('Category Optional').selectOption({ label: 'Personal' });
  await dialog.getByLabel('Task color').fill('#21a179');
  await saved(page, () => dialog.getByRole('button', { name: 'Add task' }).click());
  const task = page.locator('article').filter({ hasText: 'Plan weekend' });
  await expect(task).toContainText('Personal');
  let board = (await readBoard(request)).board;
  expect(board.tasks).toHaveLength(1);
  const taskId = board.tasks[0].id;
  expect(board.tasks[0]).toMatchObject({
    title: 'Plan weekend', description: 'Book a table', color: '#21a179',
    categoryId: board.categories[0].id, status: 'todo',
  });

  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Rename Personal').fill('Leisure');
  await saved(page, () => page.getByRole('button', { name: 'Save', exact: true }).click());
  await expect(task).toContainText('Leisure');
  await task.getByRole('button', { name: 'Edit Plan weekend' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit task' });
  await edit.getByLabel('Title', { exact: true }).fill('Plan holiday');
  await edit.getByLabel('Description Optional').fill('Reserve tickets');
  await edit.getByLabel('Task color').fill('#315eb8');
  await saved(page, () => edit.getByRole('button', { name: 'Save changes' }).click());
  await saved(page, () => page.getByRole('button', { name: 'Delete', exact: true }).click());
  board = (await readBoard(request)).board;
  expect(board.categories).toEqual([]);
  expect(board.tasks).toEqual([{
    id: taskId, title: 'Plan holiday', description: 'Reserve tickets',
    categoryId: null, color: '#315eb8', status: 'todo',
  }]);
  await page.reload();
  const edited = page.locator('article').filter({ hasText: 'Plan holiday' });
  await expect(edited).toContainText('Reserve tickets');
  await expect(edited).not.toContainText('Leisure');
  await edited.getByRole('button', { name: 'Edit Plan holiday' }).click();
  await expect(page.getByRole('dialog').getByLabel('Task color')).toHaveValue('#315eb8');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await saved(page, () => edited.getByRole('button', { name: 'Delete Plan holiday' }).click());
  await page.reload();
  await expect(page.locator('article')).toHaveCount(0);
  expect((await readBoard(request)).board).toEqual(emptyBoard);
});

test('two tabs see shared updates on focus and after reload', async ({ page, context, request }) => {
  await openBoard(page);
  const second = await context.newPage();
  await openBoard(second);
  await page.bringToFront();
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeEnabled();
  await addTask(page, 'Shared between tabs');
  await second.bringToFront();
  // Headless Chromium does not consistently emit OS window-focus events when
  // switching tabs. Exercise the app's actual focus listener deterministically.
  await second.evaluate(() => window.dispatchEvent(new Event('focus')));
  const task = second.locator('article').filter({ hasText: 'Shared between tabs' });
  await expect(task).toBeVisible();
  await saved(second, () => task.getByLabel('Status for Shared between tabs').selectOption('completed'));
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Status for Shared between tabs')).toHaveValue('completed');
  await page.reload();
  await expect(page.getByLabel('Status for Shared between tabs')).toHaveValue('completed');
  expect((await readBoard(request)).board.tasks[0].status).toBe('completed');
  await second.close();
});

test('real stale ETag returns 412, preserves unsaved draft and never overwrites newer server data', async ({ page, request }) => {
  // Only this scenario suppresses focus refresh so its original ETag stays stale.
  await page.addInitScript(() => {
    window.addEventListener('focus', (event) => event.stopImmediatePropagation(), true);
  });
  await openBoard(page);
  const original = await readBoard(request);
  const remote: BoardData = {
    ...emptyBoard,
    tasks: [{ id: 'remote', title: 'Newer server task', description: '', categoryId: null, color: '#315eb8', status: 'todo' }],
  };
  await replaceBoard(request, remote);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByLabel('Title', { exact: true }).fill('Unsaved local draft');
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/board') && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(412);
  expect(response.request().headers()['if-match']).toBe(original.etag);
  await expect(page.getByRole('alert')).toContainText('Your draft is preserved');
  await expect(page.getByRole('heading', { name: 'Unsaved local draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeDisabled();
  expect((await readBoard(request)).board).toEqual(remote);
  expect(JSON.parse(await downloadText(page, 'Export'))).toMatchObject({
    tasks: [expect.objectContaining({ title: 'Unsaved local draft' })],
  });
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.getByRole('button', { name: 'Discard draft and reload server' }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved local draft' })).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Discard draft and reload server' }).click();
  await expect(page.getByRole('heading', { name: 'Newer server task' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unsaved local draft' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await readBoard(request)).board).toEqual(remote);
});

test('keyboard reorder and cross-column movement persist through the real API and reload', async ({ page, request }) => {
  await openBoard(page);
  await addTask(page, 'First task');
  await addTask(page, 'Second task');
  const handle = page.getByRole('button', { name: 'Reorder First task', exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  expect((await readBoard(request)).board.tasks.map((task) => task.title)).toEqual(['First task', 'Second task']);
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  const preview = page.getByText('First task', { exact: true }).last();
  const beforeDown = await preview.boundingBox();
  expect(beforeDown).not.toBeNull();
  await page.keyboard.press('ArrowDown');
  // KeyboardSensor movement and collision detection settle on animation frames.
  // Wait for actual overlay movement rather than dropping in the same frame.
  await expect.poll(async () => (await preview.boundingBox())?.y).toBeGreaterThan(beforeDown!.y);
  await saved(page, () => page.keyboard.press('Space'));
  await expect(page.locator('[data-status="todo"] article h3')).toHaveText(['Second task', 'First task']);
  await page.reload();
  await expect(page.locator('[data-status="todo"] article h3')).toHaveText(['Second task', 'First task']);
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('First task is over In Progress.', { exact: true })).toBeVisible();
  await saved(page, () => page.keyboard.press('Space'));
  await expect(page.getByLabel('Status for First task')).toHaveValue('in-progress');
  await page.reload();
  await expect(page.locator('[data-status="in-progress"] article h3')).toHaveText(['First task']);
  expect((await readBoard(request)).board.tasks.find((task) => task.title === 'First task')?.status).toBe('in-progress');
});

test('JSON transfer replaces the real board only after confirmation and preserves legacy browser data', async ({ page, request }) => {
  const legacy = JSON.stringify({
    ...emptyBoard,
    tasks: [{ id: 'legacy', title: 'Legacy only', description: '', categoryId: null, color: '#315eb8', status: 'todo' }],
  });
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('shared-api-legacy-seeded')) {
      localStorage.setItem('todo-board:v1', value);
      sessionStorage.setItem('shared-api-legacy-seeded', 'yes');
    }
  }, legacy);
  await openBoard(page);
  await expect(page.locator('article')).toHaveCount(0);
  expect((await readBoard(request)).board).toEqual(emptyBoard);
  expect(await downloadText(page, 'Export legacy backup')).toBe(legacy);
  await addTask(page, 'Current shared task');
  const current = (await readBoard(request)).board;
  expect(JSON.parse(await downloadText(page, 'Export'))).toEqual(current);
  const input = page.getByLabel('Choose a ToDo board JSON file');
  await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await expect(page.getByRole('alert')).toContainText('The file is not valid JSON.');
  expect((await readBoard(request)).board).toEqual(current);
  const replacement: BoardData = {
    version: 1, categories: [{ id: 'import-category', name: 'Imported category' }],
    tasks: [{ id: 'import-task', title: 'Imported shared task', description: 'From JSON', categoryId: 'import-category', color: '#21a179', status: 'completed' }],
  };
  const file = { name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) };
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await input.setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Current shared task' })).toBeVisible();
  expect((await readBoard(request)).board).toEqual(current);
  page.once('dialog', async (confirmation) => {
    expect(confirmation.message()).toContain('Replace all current tasks and categories on the shared board');
    await confirmation.accept();
  });
  await saved(page, () => input.setInputFiles(file));
  expect((await readBoard(request)).board).toEqual(replacement);
  await page.reload();
  await expect(page.locator('[data-status="completed"] article')).toContainText('Imported shared task');
  expect(JSON.parse(await downloadText(page, 'Export'))).toEqual(replacement);
  expect(await page.evaluate(() => localStorage.getItem('todo-board:v1'))).toBe(legacy);
});

test('transport failures retain drafts and retry against the real backend', async ({ page, request }) => {
  // Inject transport loss, not fake API responses. All retries reach .NET.
  await page.route('**/api/board', (route) => route.abort('failed'), { times: 1 });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Board unavailable');
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByLabel('Title', { exact: true }).fill('Retry this draft');
  await page.route('**/api/board', (route) => route.abort('failed'), { times: 1 });
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('alert')).toContainText('Not saved');
  await expect(page.getByRole('heading', { name: 'Retry this draft' })).toBeVisible();
  expect((await readBoard(request)).board).toEqual(emptyBoard);
  await saved(page, () => page.getByRole('button', { name: 'Retry save' }).click());
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Retry this draft' })).toBeVisible();
  expect((await readBoard(request)).board.tasks[0].title).toBe('Retry this draft');
});
