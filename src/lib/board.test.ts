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
import { parseBoardData, validateBoardData } from './storage';
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

  it('validates unknown server payloads before treating them as board data', () => {
    expect(validateBoardData(populatedBoard)).toEqual(populatedBoard);
    expect(() => validateBoardData({ ...populatedBoard, version: 2 })).toThrow('supported ToDo board format');
    expect(() => validateBoardData({ ...populatedBoard, tasks: [{ ...task, status: 'blocked' }] }))
      .toThrow('invalid fields');
  });

  it('rejects imports outside the shared API limits', () => {
    expect(() => validateBoardData({
      ...populatedBoard, tasks: [{ ...task, title: 'x'.repeat(121) }],
    })).toThrow('invalid fields');
    expect(() => validateBoardData({
      ...populatedBoard, categories: [{ ...category, name: 'x'.repeat(41) }],
    })).toThrow('invalid fields');
    expect(() => validateBoardData({
      ...populatedBoard, tasks: Array.from({ length: 2001 }, (_, id) => ({ ...task, id: String(id) })),
    })).toThrow('at most 200 categories');
    expect(() => parseBoardData(' '.repeat(1_000_001))).toThrow('at most 1,000,000 bytes');
  });
});
