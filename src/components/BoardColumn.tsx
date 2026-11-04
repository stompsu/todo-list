import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { BoardCategory, BoardTask, TaskStatus } from '../types/board';
import { TASK_STATUSES } from '../lib/board';
import TaskCard from './TaskCard';
import styles from '../App.module.css';

interface Props {
  status: TaskStatus;
  tasks: BoardTask[];
  categories: Map<string, BoardCategory>;
  onEdit: (task: BoardTask) => void;
  onDelete: (task: BoardTask) => void;
  onStatusChange: (task: BoardTask, status: TaskStatus) => void;
  disabled: boolean;
  dragDisabled: boolean;
}

export default function BoardColumn({ status, tasks, categories, onEdit, onDelete, onStatusChange, disabled, dragDisabled }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status}` });
  const label = TASK_STATUSES.find((item) => item.value === status)!.label;
  return (
    <section
      ref={setNodeRef}
      className={`${styles.column} ${isOver ? styles.columnOver : ''}`}
      aria-labelledby={`column-${status}`}
      data-status={status}
    >
      <div className={styles.columnHeading}>
        <h2 id={`column-${status}`}>{label}</h2>
        <span>{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((task) => `task-${task.id}`)} strategy={verticalListSortingStrategy}>
        <div className={styles.taskList}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              category={task.categoryId ? categories.get(task.categoryId) : undefined}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task)}
              onStatusChange={(nextStatus) => onStatusChange(task, nextStatus)}
              disabled={disabled}
              dragDisabled={dragDisabled}
            />
          ))}
          {tasks.length === 0 && <p className={styles.emptyState}>Nothing here yet.</p>}
        </div>
      </SortableContext>
    </section>
  );
}
