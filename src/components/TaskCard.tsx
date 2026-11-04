import { Pencil, Trash2 } from 'lucide-react';
import { TASK_STATUSES } from '../lib/board';
import type { BoardCategory, BoardTask, TaskStatus } from '../types/board';
import styles from './TaskCard.module.css';

interface TaskCardProps {
  task: BoardTask;
  category?: BoardCategory;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: TaskStatus) => void;
}

export default function TaskCard({ task, category, onEdit, onDelete, onStatusChange }: TaskCardProps) {
  const statusLabel = TASK_STATUSES.find((status) => status.value === task.status)?.label ?? task.status;

  return (
    <article className={styles.card}>
      <div className={styles.colorRail} aria-hidden="true" style={{ backgroundColor: task.color }} />
      <div className={styles.content}>
        <div className={styles.topline}>
          <span className={styles.status}>{statusLabel}</span>
          <div className={styles.actions}>
            <button type="button" aria-label={`Edit ${task.title}`} onClick={onEdit}>
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Delete ${task.title}`} onClick={onDelete}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        <h3>{task.title}</h3>
        {task.description && <p className={styles.description}>{task.description}</p>}
        {category && <span className={styles.category}>{category.name}</span>}
        <label className={styles.moveControl}>
          Status
          <select
            aria-label={`Status for ${task.title}`}
            value={task.status}
            onChange={(event) => {
              const status = TASK_STATUSES.find((option) => option.value === event.target.value);
              if (status) onStatusChange(status.value);
            }}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
