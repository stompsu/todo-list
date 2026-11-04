import { describe, expect, it } from 'vitest';
import {
  addCategory,
  addTask,
  EMPTY_BOARD,
  removeCategory,
  removeTask,
  renameCategory,
  setTaskStatus,
  updateTask,
} from './board';
import { loadBoard, parseBoardData, saveBoard, STORAGE_KEY } from './storage';
import type { BoardData, BoardTask } from '../types/board';

const category = { id: 'work', name: 'Work' };
const task: BoardTask = {
  id: 'task-1',
  title: 'Review proposal',
  description: '',
  categoryId: 'work',
  color: '#AABBCC',
  status: 'todo',
};
const populatedBoard: BoardData = {
  version: 1,
  categories: [category],
  tasks: [task],
};

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('board operations', () => {
  it('adds, edits, moves, and deletes tasks', () => {
    const board = addTask(EMPTY_BOARD, { ...task, categoryId: null });
    const edited = updateTask(board, { ...board.tasks[0], title: 'Review final proposal' });
    const moved = setTaskStatus(edited, task.id, 'in-progress');
    expect(moved.tasks[0]).toMatchObject({ title: 'Review final proposal', status: 'in-progress' });
    expect(removeTask(moved, task.id).tasks).toEqual([]);
  });

  it('supports category creation and renaming while deletion uncategorizes tasks', () => {
    const categorized = addTask(addCategory(EMPTY_BOARD, category), task);
    const renamed = renameCategory(categorized, category.id, 'Projects');
    expect(renamed.categories[0].name).toBe('Projects');
    const deleted = removeCategory(renamed, category.id);
    expect(deleted.categories).toEqual([]);
    expect(deleted.tasks[0].categoryId).toBeNull();
  });

  it('rejects duplicate category names and references to missing categories', () => {
    expect(() => addCategory({ ...EMPTY_BOARD, categories: [category] }, { id: 'other', name: 'work' }))
      .toThrow('A category with this name already exists.');
    expect(() => addTask(EMPTY_BOARD, task)).toThrow('The selected category does not exist.');
  });
});

describe('board persistence and import validation', () => {
  it('loads and saves board data through local storage', () => {
    const storage = new MemoryStorage();
    expect(loadBoard(storage).data).toEqual(EMPTY_BOARD);
    saveBoard(populatedBoard, storage);
    expect(loadBoard(storage)).toEqual({ data: populatedBoard, issue: null });
  });

  it('leaves invalid stored data untouched and requires explicit recovery', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{broken');
    const loaded = loadBoard(storage);
    expect(loaded.issue?.kind).toBe('invalid');
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken');
  });

  it('reports read and write failures without a success-shaped fallback', () => {
    const denied = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(loadBoard(denied).issue?.kind).toBe('unavailable');
    expect(() => saveBoard(populatedBoard, denied)).toThrow('denied');
  });

  it('validates imported board structure, category links, and colors', () => {
    expect(parseBoardData(JSON.stringify(populatedBoard))).toEqual(populatedBoard);
    expect(() => parseBoardData('not-json')).toThrow('The file is not valid JSON.');
    expect(() => parseBoardData(JSON.stringify({
      ...populatedBoard,
      tasks: [{ ...task, categoryId: 'missing' }],
    }))).toThrow('A task refers to a category that does not exist.');
    expect(() => parseBoardData(JSON.stringify({
      ...populatedBoard,
      tasks: [{ ...task, color: 'blue' }],
    }))).toThrow('The board contains a category or task with invalid fields.');
  });
});
