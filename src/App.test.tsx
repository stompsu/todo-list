import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { BoardData } from './types/board';

let serverBoard: BoardData;
let revision: number;
let requests: RequestInit[];
let forceConflict: boolean;

function response(data: unknown, status = 200, version = revision) {
  return new Response(JSON.stringify(data), { status, headers: { ETag: `"v${version}"` } });
}

describe('shared ToDo board', () => {
  beforeEach(() => {
    serverBoard = { version: 1, categories: [], tasks: [] };
    revision = 1;
    requests = [];
    forceConflict = false;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) requests.push(init);
      if (init?.method === 'PUT') {
        if (forceConflict) return response({ message: 'stale' }, 412);
        if (init.headers && new Headers(init.headers).get('If-Match') !== `"v${revision}"`) {
          return response({ message: 'stale' }, 412);
        }
        serverBoard = JSON.parse(String(init.body)) as BoardData;
        revision += 1;
        return response(serverBoard, 200, revision);
      }
      return response(serverBoard);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the shared board, mutates it with If-Match, and gets the same data after reload', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByText('Shared board ready.');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Write release notes');
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(serverBoard.tasks[0]?.title).toBe('Write release notes'));
    const put = requests.find((request) => request.method === 'PUT')!;
    expect(put.method).toBe('PUT');
    expect(new Headers(put.headers).get('If-Match')).toBe('"v1"');
    first.unmount();
    render(<App />);
    expect(await screen.findByText('Write release notes')).toBeVisible();
  });

  it('keeps a failed draft and retries it using its original ETag', async () => {
    const fetchImpl = vi.mocked(fetch);
    fetchImpl.mockImplementationOnce(async () => response(serverBoard));
    fetchImpl.mockImplementationOnce(async () => new Response('temporarily unavailable', { status: 503 }));
    fetchImpl.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        requests.push(init);
        serverBoard = JSON.parse(String(init.body)) as BoardData;
        revision += 1;
        return response(serverBoard, 200, revision);
      }
      return response(serverBoard);
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Shared board ready.');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Keep this draft');
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
    expect(screen.getByText('Keep this draft')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(serverBoard.tasks[0]?.title).toBe('Keep this draft'));
    expect(new Headers(requests.at(-1)?.headers).get('If-Match')).toBe('"v1"');
  });

  it('does not rebase a stale draft and requires explicit discard before reload', async () => {
    forceConflict = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Shared board ready.');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Unsaved stale draft');
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText(/has not been rebased/)).toBeVisible();
    expect(screen.getByText('Unsaved stale draft')).toBeVisible();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Discard draft and reload server' }));
    await screen.findByText('Shared board ready.');
    expect(screen.queryByText('Unsaved stale draft')).not.toBeInTheDocument();
  });

  it('does not access legacy browser data until the explicit backup action', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Shared board ready.');
    expect(getItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Export legacy backup' }));
    expect(getItem).toHaveBeenCalledWith('todo-board:v1');
  });

  it('does not refresh the concurrency token while a task editor has an unsaved draft', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Shared board ready.');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Keep editor draft');
    const readsBeforeFocus = requests.length;
    revision += 1;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(requests).toHaveLength(readsBeforeFocus);
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText(/has not been rebased/)).toBeVisible();
    expect(serverBoard.tasks).toHaveLength(0);
    expect(screen.getByText('Keep editor draft')).toBeVisible();
  });

  it('preserves the conflicted draft when an explicit reload fails', async () => {
    forceConflict = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Shared board ready.');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Unrecoverable without backup');
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }));
    await screen.findByText(/has not been rebased/);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Discard draft and reload server' }));
    await screen.findByText('Board unavailable');
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByText('Unrecoverable without backup')).toBeVisible();
    expect(screen.getByText(/has not been rebased/)).toBeVisible();
    vi.mocked(fetch).mockResolvedValue(response(serverBoard));
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    await screen.findByText('Shared board ready.');
    expect(screen.queryByText('Unrecoverable without backup')).not.toBeInTheDocument();
  });
});
