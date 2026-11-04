import { EMPTY_BOARD } from './board';
import type { BoardData, BoardTask, BoardCategory } from '../types/board';

export const STORAGE_KEY = 'todo-board:v1';

export type StorageIssue =
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable'; message: string };

export interface BoardLoadResult {
  data: BoardData;
  issue: StorageIssue | null;
}

type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCategory(value: unknown): value is BoardCategory {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && value.name.trim().length > 0;
}

function isValidTask(value: unknown): value is BoardTask {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && typeof value.description === 'string'
    && (value.categoryId === null || typeof value.categoryId === 'string')
    && typeof value.color === 'string'
    && /^#[\da-f]{6}$/i.test(value.color)
    && typeof value.status === 'string'
    && ['todo', 'in-progress', 'completed'].includes(value.status);
}

export function parseBoardData(json: string): BoardData {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }

  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.categories) || !Array.isArray(value.tasks)) {
    throw new Error('The data does not match a supported ToDo board format.');
  }
  if (!value.categories.every(isValidCategory) || !value.tasks.every(isValidTask)) {
    throw new Error('The board contains a category or task with invalid fields.');
  }

  const categories = value.categories;
  const tasks = value.tasks;
  const categoryIds = new Set(categories.map((category) => category.id));
  const taskIds = new Set(tasks.map((task) => task.id));

  if (categoryIds.size !== categories.length || taskIds.size !== tasks.length) {
    throw new Error('The board contains duplicate identifiers.');
  }
  if (tasks.some((task) => task.categoryId !== null && !categoryIds.has(task.categoryId))) {
    throw new Error('A task refers to a category that does not exist.');
  }

  return { version: 1, categories, tasks };
}

export function loadBoard(storage?: StorageAdapter): BoardLoadResult {
  let store: StorageAdapter;
  try {
    store = storage ?? window.localStorage;
  } catch {
    return {
      data: EMPTY_BOARD,
      issue: {
        kind: 'unavailable',
        message: 'Browser storage is unavailable. Changes will stay in this tab until storage is accessible.',
      },
    };
  }

  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {
      data: EMPTY_BOARD,
      issue: {
        kind: 'unavailable',
        message: 'Saved data could not be read. It has not been changed; changes will stay in this tab.',
      },
    };
  }
  if (raw === null) return { data: EMPTY_BOARD, issue: null };

  try {
    return { data: parseBoardData(raw), issue: null };
  } catch {
    return {
      data: EMPTY_BOARD,
      issue: {
        kind: 'invalid',
        message: 'Saved board data is invalid and has been left untouched. Review or replace it explicitly before saving.',
      },
    };
  }
}

export function saveBoard(board: BoardData, storage?: StorageAdapter): void {
  const store = storage ?? window.localStorage;
  store.setItem(STORAGE_KEY, JSON.stringify(board));
}
