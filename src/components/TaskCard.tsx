import { Pencil, Trash2, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TASK_STATUSES } from '../lib/board';
import type { BoardCategory, BoardTask, TaskStatus } from '../types/board';
import styles from './TaskCard.module.css';

interface TaskCardProps {
  task: BoardTask;
  category?: BoardCategory;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: TaskStatus) => void;
  disabled?: boolean;
  dragDisabled?: boolean;
}

export default function TaskCard({ task, category, onEdit, onDelete, onStatusChange, disabled = false, dragDisabled = false }: TaskCardProps) {
  const statusLabel = TASK_STATUSES.find((status) => status.value === task.status)?.label ?? task.status;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `task-${task.id}`, disabled: disabled || dragDisabled });

  return (
    <article
      ref={setNodeRef}
      className={`${styles.card} ${isDragging ? styles.dragging : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className={styles.colorRail} aria-hidden="true" style={{ backgroundColor: task.color }} />
      <div className={styles.content}>
        <div className={styles.topline}>
          <span className={styles.status}>{statusLabel}</span>
          <div className={styles.actions}>
            <button
              ref={setActivatorNodeRef}
              type="button"
              className={styles.dragHandle}
              disabled={disabled || dragDisabled}
              {...attributes}
              aria-label={`Reorder ${task.title}`}
              {...listeners}
            >
              <GripVertical size={17} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Edit ${task.title}`} disabled={disabled} onClick={onEdit}>
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Delete ${task.title}`} disabled={disabled} onClick={onDelete}>
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
            disabled={disabled}
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
