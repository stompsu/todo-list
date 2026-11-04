import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, Plus, Search, Upload } from 'lucide-react';
import TaskCard from './components/TaskCard';
import TaskEditor from './components/TaskEditor';
import {
  addCategory,
  addTask,
  removeCategory,
  removeTask,
  renameCategory,
  setTaskStatus,
  TASK_STATUSES,
  updateTask,
} from './lib/board';
import { loadBoard, parseBoardData, saveBoard } from './lib/storage';
import type { BoardData, BoardTask } from './types/board';
import styles from './App.module.css';

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  const [initial] = useState(loadBoard);
  const [board, setBoard] = useState<BoardData>(initial.data);
  const [storageIssue, setStorageIssue] = useState(initial.issue);
  const [saveError, setSaveError] = useState('');
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
  const fileInput = useRef<HTMLInputElement>(null);

  function persist(next: BoardData, replaceBlockedData = false): boolean {
    setBoard(next);
    if (storageIssue && !replaceBlockedData) return false;
    try {
      saveBoard(next);
      setStorageIssue(null);
      setSaveError('');
      return true;
    } catch {
      setSaveError('Your changes are visible in this tab, but could not be saved to browser storage.');
      return false;
    }
  }

  function replaceStoredBoard() {
    try {
      saveBoard(board);
      setStorageIssue(null);
      setSaveError('');
      setNotice('The current board has been saved to browser storage.');
    } catch {
      setSaveError('The board could not be saved. Your existing saved data has not been replaced.');
    }
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
    setEditorOpen(true);
  }

  function saveTask(taskFields: Omit<BoardTask, 'id'>) {
    try {
      const next = editingTask
        ? updateTask(board, { ...taskFields, id: editingTask.id })
        : addTask(board, { ...taskFields, id: createId() });
      const saved = persist(next);
      setEditorOpen(false);
      setNotice(saved
        ? `${editingTask ? 'Task updated' : 'Task added'} and saved.`
        : `${editingTask ? 'Task updated' : 'Task added'} in this tab, but not saved.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The task could not be saved.');
    }
  }

  function handleAddCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      persist(addCategory(board, { id: createId(), name }));
      setNewCategoryName('');
      setCategoryError('');
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'The category could not be added.');
    }
  }

  function beginRename(categoryId: string, name: string) {
    setEditingCategoryId(categoryId);
    setCategoryName(name);
    setCategoryError('');
  }

  function handleRenameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) {
      setCategoryError('Enter a category name.');
      return;
    }
    try {
      persist(renameCategory(board, editingCategoryId, name));
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
      const imported = parseBoardData(await file.text());
      if (!window.confirm('Replace all current tasks and categories with the contents of this file?')) return;
      const saved = persist(imported, true);
      setNotice(saved ? 'Board imported and saved.' : 'Board imported into this tab, but not saved.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The file could not be imported.');
    }
  }

  function exportBoard() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'todo-board.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Board exported as JSON.');
  }

  const categoryById = new Map(board.categories.map((category) => [category.id, category]));

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">✓</div>
          <div>
            <p className={styles.eyebrow}>PERSONAL WORKSPACE</p>
            <h1>ToDo Board</h1>
          </div>
        </div>
        <button type="button" className={styles.addButton} onClick={openNewTask}>
          <Plus size={18} aria-hidden="true" />
          <span>Add task</span>
        </button>
      </header>

      <div className={styles.content}>
        {storageIssue && (
          <div className={styles.alert} role="alert">
            <div>
              <strong>Storage needs attention</strong>
              <p>{storageIssue.message}</p>
            </div>
            <button type="button" className={styles.alertButton} onClick={replaceStoredBoard}>
              Replace saved data with this board
            </button>
          </div>
        )}
        {saveError && (
          <div className={`${styles.alert} ${styles.errorAlert}`} role="alert">
            <div>
              <strong>Not saved</strong>
              <p>{saveError}</p>
            </div>
            <button type="button" className={styles.alertButton} onClick={() => {
              if (storageIssue) {
                replaceStoredBoard();
                return;
              }
              try {
                saveBoard(board);
                setSaveError('');
                setNotice('Board saved.');
              } catch {
                setSaveError('Browser storage is still unavailable. Your changes remain only in this tab.');
              }
            }}>
              Retry save
            </button>
          </div>
        )}
        {actionError && <p className={styles.inlineError} role="alert">{actionError}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <section className={styles.tools} aria-label="Board tools">
          <div className={styles.filters}>
            <label className={styles.searchBox}>
              <Search size={17} aria-hidden="true" />
              <span className={styles.srOnly}>Search task titles</span>
              <input
                type="search"
                placeholder="Search tasks"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className={styles.categoryFilter}>
              <span className={styles.srOnly}>Filter by category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">All categories</option>
                {board.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.dataActions}>
            <button type="button" className={styles.textButton} onClick={exportBoard}>
              <Download size={16} aria-hidden="true" /> Export
            </button>
            <button type="button" className={styles.textButton} onClick={() => fileInput.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Import
            </button>
            <input
              ref={fileInput}
              className={styles.hiddenInput}
              type="file"
              accept="application/json,.json"
              aria-label="Choose a ToDo board JSON file"
              onChange={handleImport}
            />
          </div>
        </section>

        <details className={styles.categories}>
          <summary>Manage categories <span>{board.categories.length}</span></summary>
          <div className={styles.categoryBody}>
            <form className={styles.categoryForm} onSubmit={handleAddCategory}>
              <label className={styles.srOnly} htmlFor="new-category">New category name</label>
              <input
                id="new-category"
                value={newCategoryName}
                maxLength={40}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="New category"
              />
              <button type="submit" className={styles.smallButton}>Add category</button>
            </form>
            {categoryError && <p className={styles.inlineError} role="alert">{categoryError}</p>}
            {board.categories.length === 0 ? (
              <p className={styles.categoryHint}>Create categories to organize your tasks. Tasks can also stay uncategorized.</p>
            ) : (
              <ul className={styles.categoryList}>
                {board.categories.map((category) => (
                  <li key={category.id}>
                    {editingCategoryId === category.id ? (
                      <form className={styles.renameForm} onSubmit={handleRenameCategory}>
                        <label className={styles.srOnly} htmlFor={`rename-${category.id}`}>Rename {category.name}</label>
                        <input
                          id={`rename-${category.id}`}
                          autoFocus
                          value={categoryName}
                          maxLength={40}
                          onChange={(event) => setCategoryName(event.target.value)}
                        />
                        <button type="submit" className={styles.smallButton}>Save</button>
                        <button type="button" className={styles.plainButton} onClick={() => setEditingCategoryId('')}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <span>{category.name}</span>
                        <div>
                          <button type="button" className={styles.plainButton} onClick={() => beginRename(category.id, category.name)}>Rename</button>
                          <button
                            type="button"
                            className={styles.plainButton}
                            onClick={() => {
                              persist(removeCategory(board, category.id));
                              if (categoryFilter === category.id) setCategoryFilter('');
                              setNotice(`${category.name} deleted; its tasks are now uncategorized.`);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <div className={styles.boardHeading}>
          <div>
            <h2>My tasks</h2>
            <p>{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}{search || categoryFilter ? ' found' : ' in your board'}</p>
          </div>
          <span className={styles.privacy}><span aria-hidden="true">●</span> Data stays in this browser</span>
        </div>

        <div className={styles.board} role="region" aria-label="Task board">
          {TASK_STATUSES.map((status) => {
            const tasks = visibleTasks.filter((task) => task.status === status.value);
            return (
              <section className={styles.column} key={status.value} aria-labelledby={`column-${status.value}`}>
                <div className={styles.columnHeading}>
                  <h2 id={`column-${status.value}`}>{status.label}</h2>
                  <span>{tasks.length}</span>
                </div>
                <div className={styles.taskList}>
                  {tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      category={task.categoryId ? categoryById.get(task.categoryId) : undefined}
                      onEdit={() => {
                        setEditingTask(task);
                        setEditorOpen(true);
                      }}
                      onDelete={() => {
                        persist(removeTask(board, task.id));
                        setNotice(`Deleted “${task.title}”.`);
                      }}
                      onStatusChange={(nextStatus) => persist(setTaskStatus(board, task.id, nextStatus))}
                    />
                  ))}
                  {tasks.length === 0 && (
                    <p className={styles.emptyState}>{visibleTasks.length === 0 ? 'No matching tasks.' : 'Nothing here yet.'}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <p className={styles.storageNote}>Your board stays private in this browser. Export a JSON backup to move it to another device.</p>
      </div>

      {editorOpen && (
        <TaskEditor
          task={editingTask}
          categories={board.categories}
          onCancel={() => setEditorOpen(false)}
          onSave={saveTask}
        />
      )}
    </main>
  );
}
