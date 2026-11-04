import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { BoardCategory, BoardTask } from '../types/board';
import styles from './TaskEditor.module.css';

interface TaskEditorProps {
  task: BoardTask | null;
  categories: BoardCategory[];
  onCancel: () => void;
  onSave: (task: Omit<BoardTask, 'id'>) => void;
  disabled?: boolean;
}

export default function TaskEditor({ task, categories, onCancel, onSave, disabled = false }: TaskEditorProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [categoryId, setCategoryId] = useState(task?.categoryId ?? '');
  const [color, setColor] = useState(task?.color ?? '#7c8da6');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Enter a task title.');
      return;
    }
    onSave({
      title: trimmedTitle,
      description: description.trim(),
      categoryId: categoryId || null,
      color,
      status: task?.status ?? 'todo',
    });
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Tab') {
            const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
            );
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className={styles.heading}>
          <h2 id="task-editor-title">{task ? 'Edit task' : 'Add a task'}</h2>
          <button type="button" className={styles.iconButton} aria-label="Close task form" onClick={onCancel}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <form className={styles.form} onSubmit={submit}>
          {disabled && <p role="status">Editing is paused while the shared board refreshes or a conflict is resolved. Your form values are preserved.</p>}
          <label>
            Title
            <input
              autoFocus
              disabled={disabled}
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to get done?"
            />
          </label>
          <label>
            Description <span className={styles.optional}>Optional</span>
            <textarea
              rows={3}
              disabled={disabled}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add a few details"
            />
          </label>
          <label>
            Category <span className={styles.optional}>Optional</span>
            <select disabled={disabled} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.colorField}>
            Task color
            <span className={styles.colorControl}>
              <input type="color" disabled={disabled} value={color} onChange={(event) => setColor(event.target.value)} />
              <span>{color.toUpperCase()}</span>
            </span>
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
            <button type="submit" className={styles.primaryButton} disabled={disabled}>{task ? 'Save changes' : 'Add task'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
