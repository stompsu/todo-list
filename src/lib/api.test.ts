import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardApiError, fetchBoard, putBoard } from './api';
import type { BoardData } from '../types/board';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const board: BoardData = { version: 1, categories: [], tasks: [] };

afterEach(() => vi.unstubAllGlobals());

describe('shared board API validation', () => {
  it('excludes API paths from Static Web Apps navigation fallback', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'public/staticwebapp.config.json'), 'utf8'));
    expect(config.navigationFallback.exclude).toContain('/api/*');
  });

  it('accepts a valid board only when the response includes an ETag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(board), {
      status: 200,
      headers: { ETag: '"v1"', 'Content-Type': 'application/json' },
    })));
    await expect(fetchBoard()).resolves.toEqual({ board, etag: '"v1"' });
  });

  it('rejects malformed, unsupported, or versionless server responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(board), { status: 200 }))
      .mockResolvedValueOnce(new Response('{bad', { status: 200, headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...board, version: 2 }), {
        status: 200, headers: { ETag: '"v2"' },
      })));

    await expect(fetchBoard()).rejects.toThrow('did not include a board version');
    await expect(fetchBoard()).rejects.toThrow('invalid JSON');
    await expect(fetchBoard()).rejects.toThrow('invalid board data');
  });

  it('sends full board data with mandatory If-Match and preserves stale-conflict status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('stale', { status: 412 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(board), { status: 200, headers: { ETag: '"v2"' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(putBoard(board, '"v1"')).rejects.toMatchObject<Partial<BoardApiError>>({ status: 412 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/board');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({ 'If-Match': '"v1"', 'Content-Type': 'application/json' }),
      body: JSON.stringify(board),
    });
  });

  it('reports the missing-token API response distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('token required', { status: 428 })));
    await expect(putBoard(board, '"v1"')).rejects.toMatchObject({ status: 428 });
  });

  it.each(['W/"v1"', '"v1", "v2"', 'v1'])('rejects unusable ETag %s', async (etag) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(board), {
      status: 200, headers: { ETag: etag },
    })));
    await expect(fetchBoard()).rejects.toThrow('single strong ETag');
  });
});
