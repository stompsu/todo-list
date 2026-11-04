import type { BoardData } from '../types/board';
import { validateBoardData } from './storage';

export interface VersionedBoard {
  board: BoardData;
  etag: string;
}

export class BoardApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BoardApiError';
  }
}

async function readVersionedBoard(response: Response): Promise<VersionedBoard> {
  if (!response.ok) {
    if (response.status === 412) throw new BoardApiError('This board changed elsewhere. Reload before continuing.', 412);
    if (response.status === 428) throw new BoardApiError('The board request was missing its required version token.', 428);
    throw new BoardApiError(`The board request failed (HTTP ${response.status}).`, response.status);
  }

  const etag = response.headers.get('ETag');
  if (!etag || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) {
    throw new BoardApiError('The server response did not include a board version (ETag). A single strong ETag is required.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BoardApiError('The server returned invalid JSON for the board.');
  }

  try {
    return { board: validateBoardData(payload), etag };
  } catch (error) {
    throw new BoardApiError(error instanceof Error
      ? `The server returned invalid board data: ${error.message}`
      : 'The server returned invalid board data.');
  }
}

export async function fetchBoard(signal?: AbortSignal): Promise<VersionedBoard> {
  let response: Response;
  try {
    response = await fetch('/api/board', { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new BoardApiError('Could not connect to the board service. Check your connection and retry.');
  }
  return readVersionedBoard(response);
}

export async function putBoard(board: BoardData, etag: string): Promise<VersionedBoard> {
  let response: Response;
  try {
    response = await fetch('/api/board', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'If-Match': etag },
      body: JSON.stringify(board),
    });
  } catch {
    throw new BoardApiError('Could not connect to the board service. Your draft is preserved.');
  }
  return readVersionedBoard(response);
}
