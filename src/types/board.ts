export type TaskStatus = 'todo' | 'in-progress' | 'completed';

export interface BoardCategory {
  id: string;
  name: string;
}

export interface BoardTask {
  id: string;
  title: string;
  description: string;
  categoryId: string | null;
  color: string;
  status: TaskStatus;
}

export interface BoardData {
  version: 1;
  categories: BoardCategory[];
  tasks: BoardTask[];
}
