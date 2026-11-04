import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { EMPTY_BOARD } from './lib/board';
import { STORAGE_KEY } from './lib/storage';

describe('ToDo board', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('creates, edits, moves, deletes, and persists tasks across a reload', async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    let dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Draft release notes');
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));

    let task = screen.getByRole('article');
    await user.click(within(task).getByRole('button', { name: 'Edit Draft release notes' }));
    dialog = screen.getByRole('dialog', { name: 'Edit task' });
    const title = within(dialog).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Write release notes');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    task = screen.getByRole('article');
    await user.selectOptions(within(task).getByLabelText('Status for Write release notes'), 'completed');
    expect(within(task).getByLabelText('Status for Write release notes')).toHaveValue('completed');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0]).toMatchObject({
      title: 'Write release notes',
      status: 'completed',
    });

    firstRender.unmount();
    render(<App />);
    task = screen.getByRole('article');
    expect(within(task).getByText('Write release notes')).toBeVisible();
    expect(within(task).getByLabelText('Status for Write release notes')).toHaveValue('completed');
    await user.click(within(task).getByRole('button', { name: 'Delete Write release notes' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks).toEqual([]);
  });

  it('keeps task color independent from category and uncategorizes tasks on category deletion', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Manage categories'));
    await user.type(screen.getByLabelText('New category name'), 'Home');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Water plants');
    const categoryId = within(dialog).getByRole('option', { name: 'Home' }).getAttribute('value');
    await user.selectOptions(within(dialog).getByLabelText('Category Optional'), categoryId!);
    fireEvent.change(within(dialog).getByLabelText(/Task color/), { target: { value: '#21a179' } });
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));

    let data = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(data.tasks[0]).toMatchObject({ categoryId: expect.any(String), color: '#21a179' });
    const categoryRow = screen.getByRole('listitem');
    await user.click(within(categoryRow).getByRole('button', { name: 'Delete' }));

    data = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(data.categories).toEqual([]);
    expect(data.tasks[0].categoryId).toBeNull();
    expect(screen.getByText('Water plants')).toBeVisible();
  });

  it('combines category filtering with title search', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Manage categories'));
    for (const name of ['Work', 'Home']) {
      await user.type(screen.getByLabelText('New category name'), name);
      await user.click(screen.getByRole('button', { name: 'Add category' }));
    }

    for (const [title, categoryName] of [['Prepare release', 'Work'], ['Plan dinner', 'Home']]) {
      await user.click(screen.getByRole('button', { name: 'Add task' }));
      const dialog = screen.getByRole('dialog', { name: 'Add a task' });
      await user.type(within(dialog).getByLabelText('Title'), title);
      const categoryId = within(dialog).getByRole('option', { name: categoryName }).getAttribute('value');
      await user.selectOptions(within(dialog).getByLabelText('Category Optional'), categoryId!);
      await user.click(within(dialog).getByRole('button', { name: 'Add task' }));
    }

    const filter = screen.getByLabelText('Filter by category');
    const workId = within(filter).getByRole('option', { name: 'Work' }).getAttribute('value');
    await user.selectOptions(filter, workId!);
    expect(screen.getByText('Prepare release')).toBeVisible();
    expect(screen.queryByText('Plan dinner')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search task titles' }), 'Plan');
    expect(screen.queryByText('Prepare release')).not.toBeInTheDocument();
    await user.selectOptions(filter, '');
    expect(screen.getByText('Plan dinner')).toBeVisible();
    expect(screen.queryByText('Prepare release')).not.toBeInTheDocument();
  });

  it('does not overwrite invalid stored data until the user explicitly replaces it', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, '{invalid');
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('has been left untouched');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{invalid');
    await user.click(screen.getByRole('button', { name: 'Replace saved data with this board' }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(EMPTY_BOARD));
    expect(screen.queryByText('Storage needs attention')).not.toBeInTheDocument();
  });

  it('reports failed storage writes instead of claiming the task was saved', async () => {
    const user = userEvent.setup();
    render(<App />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Keep working');
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));

    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved to browser storage');
    expect(screen.getByRole('status')).toHaveTextContent('in this tab, but not saved');
  });
});
