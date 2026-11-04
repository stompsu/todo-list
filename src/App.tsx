import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners,
  type DragEndEvent, type DragStartEvent, type Announcements, useSensor, useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Download, Plus, Search, Upload } from 'lucide-react';
import BoardColumn from './components/BoardColumn';
import TaskEditor from './components/TaskEditor';
import {
  addCategory, addTask, removeCategory, removeTask, renameCategory,
  setTaskStatus, TASK_STATUSES, updateTask,
} from './lib/board';
import { BoardApiError, fetchBoard, putBoard, type VersionedBoard } from './lib/api';
import { parseBoardData, STORAGE_KEY } from './lib/storage';
import type { BoardData, BoardTask, TaskStatus } from './types/board';
import styles from './App.module.css';

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusForDrop(id: string, board: BoardData): TaskStatus | undefined {
  const task = board.tasks.find((item) => `task-${item.id}` === id);
  if (task) return task.status;
  return id.startsWith('column-') ? id.slice('column-'.length) as TaskStatus : undefined;
}

function reorderBoard(board: BoardData, activeId: string, overId: string): BoardData {
  const active = board.tasks.find((task) => task.id === activeId);
  const targetStatus = statusForDrop(overId, board);
  if (!active || !targetStatus) return board;
  const sourceStatus = active.status;
  if (sourceStatus === targetStatus) {
    const reordered = board.tasks.filter((task) => task.status === sourceStatus);
    const from = reordered.findIndex((task) => task.id === activeId);
    const to = overId.startsWith('column-')
      ? reordered.length - 1
      : reordered.findIndex((task) => `task-${task.id}` === overId);
    if (from < 0 || to < 0 || from === to) return board;
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const replacement = [...board.tasks];
    let index = 0;
    for (let i = 0; i < replacement.length; i += 1) {
      if (replacement[i].status === sourceStatus) replacement[i] = reordered[index++];
    }
    return { ...board, tasks: replacement };
  }
  const groups = new Map<TaskStatus, BoardTask[]>();
  for (const status of TASK_STATUSES) {
    groups.set(status.value, board.tasks.filter((task) => task.status === status.value && task.id !== activeId));
  }
  const destination = groups.get(targetStatus)!;
  const targetIndex = destination.findIndex((task) => `task-${task.id}` === overId);
  const insertAt = targetIndex < 0 ? destination.length : targetIndex;
  destination.splice(insertAt, 0, { ...active, status: targetStatus });
  return { ...board, tasks: TASK_STATUSES.flatMap((status) => groups.get(status.value)!) };
}

function downloadJson(name: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type LoadState = 'loading' | 'ready' | 'error';

export default function App() {
  const [board, setBoard] = useState<BoardData>({ version: 1, categories: [], tasks: [] });
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BoardTask | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [actionError, setActionError] = useState('');
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const etag = useRef('');
  const draft = useRef(board);
  const dirty = useRef(false);
  const requestInFlight = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const acceptServerBoard = useCallback((result: VersionedBoard) => {
    etag.current = result.etag;
    draft.current = result.board;
    dirty.current = false;
    setBoard(result.board);
    setConflict(false);
    setSaveError('');
  }, []);

  const loadFromServer = useCallback(async (discardDraft = false) => {
    if (requestInFlight.current || (dirty.current && !discardDraft)) return;
    requestInFlight.current = true;
    setLoadState('loading');
    setLoadError('');
    try {
      const loaded = await fetchBoard();
      if (discardDraft || !dirty.current) acceptServerBoard(loaded);
      setLoadState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLoadError(error instanceof Error ? error.message : 'The board could not be loaded.');
      setLoadState('error');
    } finally {
      requestInFlight.current = false;
    }
  }, [acceptServerBoard]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  useEffect(() => {
    const refresh = () => {
      if (!dirty.current && !requestInFlight.current && !conflict
          && !editorOpen && !editingCategoryId && !newCategoryName && !activeTask) {
        void loadFromServer();
      }
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [conflict, loadFromServer, editorOpen, editingCategoryId, newCategoryName, activeTask]);

  async function saveSnapshot(snapshot: BoardData) {
    requestInFlight.current = true;
    setSaving(true);
    try {
      const committed = await putBoard(snapshot, etag.current);
      etag.current = committed.etag;
      if (JSON.stringify(draft.current) === JSON.stringify(snapshot)) {
        draft.current = committed.board;
        dirty.current = false;
        setBoard(committed.board);
        setNotice('Changes saved to the shared board.');
      }
      setSaveError('');
      setConflict(false);
    } catch (error) {
      if (error instanceof BoardApiError && error.status === 412) setConflict(true);
      setSaveError(error instanceof Error ? error.message : 'Your draft could not be saved.');
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  }

  function persist(next: BoardData, message?: string) {
    draft.current = next;
    dirty.current = true;
    setBoard(next);
    setSaveError('');
    setNotice(message ?? '');
    saveQueue.current = saveQueue.current.then(() => saveSnapshot(next));
  }

  function retrySave() {
    if (conflict || !dirty.current) return;
    const snapshot = draft.current;
    saveQueue.current = saveQueue.current.then(() => saveSnapshot(snapshot));
  }

  function discardAndReload() {
    if (!window.confirm('Discard your unsaved draft and reload the latest shared board?')) return;
    void loadFromServer(true);
  }

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return board.tasks.filter((task) => (
      (!query || task.title.toLocaleLowerCase().includes(query))
      && (!categoryFilter || task.categoryId === categoryFilter)
    ));
  }, [board.tasks, categoryFilter, search]);

  function openNewTask() {
    setEditingTask(null);
    setActionError('');
    setEditorOpen(true);
  }

  function saveTask(fields: Omit<BoardTask, 'id'>) {
    try {
      persist(editingTask
        ? updateTask(draft.current, { ...fields, id: editingTask.id })
        : addTask(draft.current, { ...fields, id: createId() }),
      `${editingTask ? 'Task updated' : 'Task added'}; saving to shared board.`);
      setEditorOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The task could not be saved.');
    }
  }

  function handleAddCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      persist(addCategory(draft.current, { id: createId(), name }));
      setNewCategoryName('');
      setCategoryError('');
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'The category could not be added.');
    }
  }

  function handleRenameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) {
      setCategoryError('Enter a category name.');
      return;
    }
    try {
      persist(renameCategory(draft.current, editingCategoryId, name));
      setEditingCategoryId('');
      setCategoryError('');
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'The category could not be renamed.');
    }
  }

  async function handleImport(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setActionError('');
    try {
      if (file.size > 1_000_000) throw new Error('The board file must be at most 1,000,000 bytes.');
      const imported = parseBoardData(await file.text());
      if (!window.confirm('Replace all current tasks and categories on the shared board with the contents of this file?')) return;
      persist(imported, 'Import accepted; replacing the shared board.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The file could not be imported.');
    }
  }

  function exportLegacyBackup() {
    try {
      const legacy = window.localStorage.getItem(STORAGE_KEY);
      if (legacy === null) {
        setNotice('No legacy browser backup was found.');
        return;
      }
      downloadJson('todo-board-legacy-backup.json', legacy);
      setNotice('Legacy browser backup exported without changing it.');
    } catch {
      setActionError('The legacy browser backup could not be read; it has not been changed.');
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(draft.current.tasks.find((task) => `task-${task.id}` === event.active.id) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    if (!event.over || event.active.id === event.over.id || search || categoryFilter || conflict) return;
    const next = reorderBoard(draft.current, String(event.active.id).slice('task-'.length), String(event.over.id));
    if (next !== draft.current) persist(next, 'Task moved; saving to shared board.');
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      const task = draft.current.tasks.find((item) => `task-${item.id}` === active.id);
      return task ? `Picked up ${task.title}.` : 'Picked up task.';
    },
    onDragOver({ active, over }) {
      if (!over) return 'Task is no longer over a drop target.';
      const task = draft.current.tasks.find((item) => `task-${item.id}` === active.id);
      const label = TASK_STATUSES.find((item) => item.value === statusForDrop(String(over.id), draft.current))?.label;
      return `${task?.title ?? 'Task'} is over ${label ?? 'a task position'}.`;
    },
    onDragEnd({ active, over }) {
      const task = draft.current.tasks.find((item) => `task-${item.id}` === active.id);
      const label = over && TASK_STATUSES.find((item) => item.value === statusForDrop(String(over.id), draft.current))?.label;
      return over ? `${task?.title ?? 'Task'} dropped in ${label ?? 'the board'}.` : 'Task drop cancelled.';
    },
    onDragCancel() { return 'Task movement cancelled.'; },
  };

  const categoryById = new Map(board.categories.map((category) => [category.id, category]));
  const canEdit = loadState === 'ready' && !conflict;

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">✓</div>
          <div><p className={styles.eyebrow}>SHARED WORKSPACE</p><h1>ToDo Board</h1></div>
        </div>
        <button type="button" className={styles.addButton} onClick={openNewTask} disabled={!canEdit}>
          <Plus size={18} aria-hidden="true" /><span>Add task</span>
        </button>
      </header>

      <div className={styles.content}>
        {loadState === 'loading' && <p role="status">Loading shared board…</p>}
        {loadState === 'error' && <div className={`${styles.alert} ${styles.errorAlert}`} role="alert">
          <div><strong>Board unavailable</strong><p>{loadError}</p></div>
          <button type="button" className={styles.alertButton} onClick={() => {
            if (conflict) discardAndReload();
            else void loadFromServer();
          }}>Retry loading</button>
        </div>}
        {conflict && <div className={`${styles.alert} ${styles.errorAlert}`} role="alert">
          <div><strong>Shared board conflict</strong><p>Your draft is preserved, and has not been rebased over newer data.</p></div>
          <button type="button" className={styles.alertButton} onClick={discardAndReload}>Discard draft and reload server</button>
        </div>}
        {saveError && !conflict && <div className={`${styles.alert} ${styles.errorAlert}`} role="alert">
          <div><strong>Not saved</strong><p>{saveError} Your draft remains visible.</p></div>
          <button type="button" className={styles.alertButton} disabled={saving} onClick={retrySave}>Retry save</button>
        </div>}
        {actionError && <p className={styles.inlineError} role="alert">{actionError}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        <p className={styles.srOnly} role="status" aria-live="polite">
          {saving ? 'Saving shared board.' : loadState === 'ready' ? 'Shared board ready.' : ''}
        </p>

        <section className={styles.tools} aria-label="Board tools">
          <div className={styles.filters}>
            <label className={styles.searchBox}><Search size={17} aria-hidden="true" />
              <span className={styles.srOnly}>Search task titles</span>
              <input type="search" placeholder="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <label className={styles.categoryFilter}><span className={styles.srOnly}>Filter by category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">All categories</option>
                {board.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.dataActions}>
            <button type="button" className={styles.textButton} disabled={loadState !== 'ready'} onClick={() => downloadJson('todo-board.json', JSON.stringify(board, null, 2))}>
              <Download size={16} aria-hidden="true" /> Export
            </button>
            <button type="button" className={styles.textButton} onClick={exportLegacyBackup}>Export legacy backup</button>
            <button type="button" className={styles.textButton} disabled={!canEdit} onClick={() => fileInput.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Import
            </button>
            <input ref={fileInput} className={styles.hiddenInput} type="file" accept="application/json,.json"
              aria-label="Choose a ToDo board JSON file" onChange={handleImport} />
          </div>
        </section>

        <details className={styles.categories}>
          <summary>Manage categories <span>{board.categories.length}</span></summary>
          <div className={styles.categoryBody}>
            <form className={styles.categoryForm} onSubmit={handleAddCategory}>
              <label className={styles.srOnly} htmlFor="new-category">New category name</label>
              <input id="new-category" value={newCategoryName} maxLength={40} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="New category" />
              <button type="submit" className={styles.smallButton} disabled={!canEdit}>Add category</button>
            </form>
            {categoryError && <p className={styles.inlineError} role="alert">{categoryError}</p>}
            {board.categories.length === 0 ? <p className={styles.categoryHint}>Create categories to organize tasks.</p> : (
              <ul className={styles.categoryList}>{board.categories.map((category) => <li key={category.id}>
                {editingCategoryId === category.id ? <form className={styles.renameForm} onSubmit={handleRenameCategory}>
                  <label className={styles.srOnly} htmlFor={`rename-${category.id}`}>Rename {category.name}</label>
                  <input id={`rename-${category.id}`} autoFocus value={categoryName} maxLength={40} onChange={(event) => setCategoryName(event.target.value)} />
                  <button type="submit" className={styles.smallButton}>Save</button>
                  <button type="button" className={styles.plainButton} onClick={() => setEditingCategoryId('')}>Cancel</button>
                </form> : <><span>{category.name}</span><div>
                  <button type="button" className={styles.plainButton} disabled={!canEdit} onClick={() => { setEditingCategoryId(category.id); setCategoryName(category.name); }}>Rename</button>
                  <button type="button" className={styles.plainButton} disabled={!canEdit} onClick={() => {
                    persist(removeCategory(draft.current, category.id));
                    if (categoryFilter === category.id) setCategoryFilter('');
                  }}>Delete</button>
                </div></>}
              </li>)}</ul>
            )}
          </div>
        </details>

        <div className={styles.boardHeading}>
          <div><h2>My tasks</h2><p>{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}</p></div>
          <span className={styles.privacy}><span aria-hidden="true">●</span> Shared board</span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          accessibility={{ announcements, screenReaderInstructions: { draggable: 'Press Space to pick up a task, use arrow keys to move it, Space to drop, or Escape to cancel.' } }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveTask(null)}
        >
          <div className={styles.board} role="region" aria-label="Task board">
            {TASK_STATUSES.map((status) => <BoardColumn
              key={status.value}
              status={status.value}
              tasks={visibleTasks.filter((task) => task.status === status.value)}
              categories={categoryById}
              onEdit={(task) => { setEditingTask(task); setActionError(''); setEditorOpen(true); }}
              onDelete={(task) => persist(removeTask(draft.current, task.id), `Deleted “${task.title}”; saving.`)}
              onStatusChange={(task, nextStatus) => persist(setTaskStatus(draft.current, task.id, nextStatus), 'Task status changed; saving.')}
              disabled={!canEdit}
              dragDisabled={Boolean(search || categoryFilter)}
            />)}
          </div>
          <DragOverlay>{activeTask ? <div className={styles.dragPreview}>{activeTask.title}</div> : null}</DragOverlay>
        </DndContext>
        <p className={styles.storageNote}>Shared changes are saved online. Export a JSON file for backup.</p>
      </div>
      {editorOpen && <TaskEditor task={editingTask} categories={board.categories} onCancel={() => setEditorOpen(false)} onSave={saveTask} disabled={!canEdit} />}
    </main>
  );
}
