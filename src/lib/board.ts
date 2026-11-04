import type { BoardCategory, BoardData, BoardTask, TaskStatus } from '../types/board';

export const EMPTY_BOARD: BoardData = {
  version: 1,
  categories: [],
  tasks: [],
};

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

export function addTask(board: BoardData, task: BoardTask): BoardData {
  if (board.tasks.some((existing) => existing.id === task.id)) {
    throw new Error('A task with this identifier already exists.');
  }
  if (task.categoryId && !board.categories.some((category) => category.id === task.categoryId)) {
    throw new Error('The selected category does not exist.');
  }
  return { ...board, tasks: [...board.tasks, task] };
}

export function updateTask(board: BoardData, task: BoardTask): BoardData {
  if (!board.tasks.some((existing) => existing.id === task.id)) {
    throw new Error('The task no longer exists.');
  }
  if (task.categoryId && !board.categories.some((category) => category.id === task.categoryId)) {
    throw new Error('The selected category does not exist.');
  }
  return { ...board, tasks: board.tasks.map((existing) => existing.id === task.id ? task : existing) };
}

export function removeTask(board: BoardData, taskId: string): BoardData {
  return { ...board, tasks: board.tasks.filter((task) => task.id !== taskId) };
}

export function setTaskStatus(board: BoardData, taskId: string, status: TaskStatus): BoardData {
  if (!TASK_STATUSES.some((option) => option.value === status)) {
    throw new Error('The selected status is not valid.');
  }
  return {
    ...board,
    tasks: board.tasks.map((task) => task.id === taskId ? { ...task, status } : task),
  };
}

export function addCategory(board: BoardData, category: BoardCategory): BoardData {
  if (board.categories.some((existing) => existing.id === category.id)) {
    throw new Error('A category with this identifier already exists.');
  }
  if (board.categories.some((existing) => existing.name.toLocaleLowerCase() === category.name.toLocaleLowerCase())) {
    throw new Error('A category with this name already exists.');
  }
  return { ...board, categories: [...board.categories, category] };
}

export function renameCategory(board: BoardData, categoryId: string, name: string): BoardData {
  if (!board.categories.some((category) => category.id === categoryId)) {
    throw new Error('The category no longer exists.');
  }
  if (board.categories.some((category) => (
    category.id !== categoryId && category.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  ))) {
    throw new Error('A category with this name already exists.');
  }
  return {
    ...board,
    categories: board.categories.map((category) => category.id === categoryId ? { ...category, name } : category),
  };
}

export function removeCategory(board: BoardData, categoryId: string): BoardData {
  return {
    ...board,
    categories: board.categories.filter((category) => category.id !== categoryId),
    tasks: board.tasks.map((task) => task.categoryId === categoryId ? { ...task, categoryId: null } : task),
  };
}
