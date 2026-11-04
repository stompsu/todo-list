import type { BoardData, BoardTask, BoardCategory } from '../types/board';

export const STORAGE_KEY = 'todo-board:v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCategory(value: unknown): value is BoardCategory {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 100
    && typeof value.name === 'string'
    && value.name.trim().length > 0
    && value.name.length <= 40;
}

function isValidTask(value: unknown): value is BoardTask {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 100
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && value.title.length <= 120
    && typeof value.description === 'string'
    && value.description.length <= 1000
    && (value.categoryId === null || typeof value.categoryId === 'string')
    && typeof value.color === 'string'
    && /^#[\da-f]{6}$/i.test(value.color)
    && typeof value.status === 'string'
    && ['todo', 'in-progress', 'completed'].includes(value.status);
}

export function validateBoardData(value: unknown): BoardData {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.categories) || !Array.isArray(value.tasks)) {
    throw new Error('The data does not match a supported ToDo board format.');
  }
  if (value.categories.length > 200 || value.tasks.length > 2000) {
    throw new Error('A board supports at most 200 categories and 2,000 tasks.');
  }
  if (!value.categories.every(isValidCategory) || !value.tasks.every(isValidTask)) {
    throw new Error('The board contains a category or task with invalid fields.');
  }

  const categories = value.categories.map((category) => ({ id: category.id, name: category.name }));
  const tasks = value.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    categoryId: task.categoryId,
    color: task.color,
    status: task.status,
  }));
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

export function parseBoardData(json: string): BoardData {
  if (new TextEncoder().encode(json).length > 1_000_000) {
    throw new Error('The board file must be at most 1,000,000 bytes.');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }

  return validateBoardData(value);
}
