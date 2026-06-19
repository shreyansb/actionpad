import type { AgentRun, AgentThread, OutlineState } from "../domain/types"

export const ACTIONPAD_DB_NAME = "actionpad"
export const ACTIONPAD_DB_VERSION = 1
export const DOCUMENTS_STORE = "documents"
export const DEFAULT_DOCUMENT_ID = "default"
export const PERSISTED_DOCUMENT_SCHEMA_VERSION = 1
export const ACTIONPAD_BACKUP_EXPORT_VERSION = 1

export type PersistedDocument = {
  id: typeof DEFAULT_DOCUMENT_ID
  schemaVersion: typeof PERSISTED_DOCUMENT_SCHEMA_VERSION
  savedAt: number
  state: OutlineState
}

type BackupAgentThread = Omit<AgentThread, "messages" | "events">
type BackupAgentRun = Omit<AgentRun, "prompt" | "context">
type BackupOutlineState = Omit<OutlineState, "threads" | "runs" | "undoStack" | "redoStack"> & {
  threads: Record<string, BackupAgentThread>
  runs: Record<string, BackupAgentRun>
  undoStack: []
  redoStack: []
}
type BackupPersistedDocument = Omit<PersistedDocument, "state"> & {
  state: BackupOutlineState
}

export type ActionpadBackup = {
  exportVersion: typeof ACTIONPAD_BACKUP_EXPORT_VERSION
  exportedAt: number
  origin: string | null
  databases: Array<{
    name: typeof ACTIONPAD_DB_NAME
    version: typeof ACTIONPAD_DB_VERSION
    objectStores: Array<{
      name: typeof DOCUMENTS_STORE
      keyPath: "id"
      records: Array<PersistedDocument | BackupPersistedDocument>
    }>
  }>
}

export type DocumentPersistence = {
  loadDocument: () => Promise<OutlineState | null>
  saveDocument: (state: OutlineState) => Promise<void>
  clearDocument: () => Promise<void>
  exportBackup?: () => Promise<ActionpadBackup | null>
  importBackup?: (backup: unknown) => Promise<OutlineState>
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACTIONPAD_DB_NAME, ACTIONPAD_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."))
  })
}

export function isPersistedDocument(value: unknown): value is PersistedDocument {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (!record.state || typeof record.state !== "object") return false
  const state = record.state as Record<string, unknown>
  return (
    record.id === DEFAULT_DOCUMENT_ID &&
    record.schemaVersion === PERSISTED_DOCUMENT_SCHEMA_VERSION &&
    typeof record.savedAt === "number" &&
    Array.isArray(state.rootIds) &&
    typeof state.nodes === "object" &&
    state.nodes !== null &&
    Array.isArray(state.undoStack)
  )
}

function createPortableOutlineState(state: OutlineState): BackupOutlineState {
  const threads = Object.fromEntries(
    Object.entries(state.threads).map(([threadId, thread]) => {
      const { messages: _messages, events: _events, ...backupThread } = thread
      return [threadId, backupThread]
    }),
  )
  const runs = Object.fromEntries(
    Object.entries(state.runs).map(([runId, run]) => {
      const { prompt: _prompt, context: _context, ...backupRun } = run
      return [runId, backupRun]
    }),
  )

  return {
    ...state,
    threads,
    runs,
    undoStack: [],
    redoStack: [],
  }
}

function createPersistedOutlineState(state: OutlineState): OutlineState {
  return {
    ...state,
    undoStack: [],
    redoStack: [],
  }
}

function createLoadedOutlineState(state: OutlineState): OutlineState {
  return {
    ...state,
    redoStack: Array.isArray((state as { redoStack?: unknown }).redoStack)
      ? state.redoStack
      : [],
  }
}

function createPortablePersistedDocument(
  persistedDocument: PersistedDocument,
): BackupPersistedDocument {
  return {
    ...persistedDocument,
    state: createPortableOutlineState(persistedDocument.state),
  }
}

function createRestoredOutlineState(state: OutlineState): OutlineState {
  const rawThreads = state.threads as Record<string, Partial<AgentThread>>
  const threads = Object.fromEntries(
    Object.entries(rawThreads).map(([threadId, thread]) => [
      threadId,
      {
        ...thread,
        messages: Array.isArray(thread.messages) ? thread.messages : [],
        events: Array.isArray(thread.events) ? thread.events : [],
      } as AgentThread,
    ]),
  )
  const rawRuns = state.runs as Record<string, Partial<AgentRun>>
  const runs = Object.fromEntries(
    Object.entries(rawRuns).map(([runId, run]) => [
      runId,
      {
        ...run,
        prompt: typeof run.prompt === "string" ? run.prompt : "",
        context: typeof run.context === "string" ? run.context : "",
      } as AgentRun,
    ]),
  )

  return {
    ...state,
    threads,
    runs,
    undoStack: [],
    redoStack: [],
  }
}

function createRestoredPersistedDocument(persistedDocument: PersistedDocument): PersistedDocument {
  return {
    ...persistedDocument,
    state: createRestoredOutlineState(persistedDocument.state),
  }
}

export function createActionpadBackup(
  persistedDocument: PersistedDocument,
  options: { exportedAt: number; origin: string | null },
): ActionpadBackup {
  const portableDocument = createPortablePersistedDocument(persistedDocument)

  return {
    exportVersion: ACTIONPAD_BACKUP_EXPORT_VERSION,
    exportedAt: options.exportedAt,
    origin: options.origin,
    databases: [
      {
        name: ACTIONPAD_DB_NAME,
        version: ACTIONPAD_DB_VERSION,
        objectStores: [
          {
            name: DOCUMENTS_STORE,
            keyPath: "id",
            records: [portableDocument],
          },
        ],
      },
    ],
  }
}

export function getPersistedDocumentFromBackup(backup: unknown): PersistedDocument | null {
  if (!backup || typeof backup !== "object") return null
  const record = backup as Record<string, unknown>
  if (
    record.exportVersion !== ACTIONPAD_BACKUP_EXPORT_VERSION ||
    typeof record.exportedAt !== "number" ||
    !("origin" in record) ||
    (record.origin !== null && typeof record.origin !== "string") ||
    !Array.isArray(record.databases)
  ) {
    return null
  }

  const actionpadDatabase = record.databases.find((database) => {
    if (!database || typeof database !== "object") return false
    const databaseRecord = database as Record<string, unknown>
    return databaseRecord.name === ACTIONPAD_DB_NAME && databaseRecord.version === ACTIONPAD_DB_VERSION
  }) as Record<string, unknown> | undefined
  if (!actionpadDatabase || !Array.isArray(actionpadDatabase.objectStores)) return null

  const documentsStore = actionpadDatabase.objectStores.find((store) => {
    if (!store || typeof store !== "object") return false
    const storeRecord = store as Record<string, unknown>
    return storeRecord.name === DOCUMENTS_STORE && storeRecord.keyPath === "id"
  }) as Record<string, unknown> | undefined
  if (!documentsStore || !Array.isArray(documentsStore.records)) return null

  const persistedDocument = documentsStore.records.find(
    (storeRecord) =>
      isPersistedDocument(storeRecord) && storeRecord.id === DEFAULT_DOCUMENT_ID,
  )
  return persistedDocument ? createRestoredPersistedDocument(persistedDocument) : null
}

export function isActionpadBackup(value: unknown): value is ActionpadBackup {
  return getPersistedDocumentFromBackup(value) !== null
}

export function createIndexedDbDocumentPersistence(
  now: () => number = Date.now,
): DocumentPersistence {
  return {
    async loadDocument() {
      if (!globalThis.indexedDB) return null
      const database = await openDatabase()
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, "readonly")
        const store = transaction.objectStore(DOCUMENTS_STORE)
        const persisted = await requestToPromise<unknown>(store.get(DEFAULT_DOCUMENT_ID))
        if (!isPersistedDocument(persisted)) return null
        return createLoadedOutlineState(persisted.state)
      } finally {
        database.close()
      }
    },

    async saveDocument(state) {
      if (!globalThis.indexedDB) return
      const database = await openDatabase()
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, "readwrite")
        const store = transaction.objectStore(DOCUMENTS_STORE)
        await requestToPromise(
          store.put({
            id: DEFAULT_DOCUMENT_ID,
            schemaVersion: PERSISTED_DOCUMENT_SCHEMA_VERSION,
            savedAt: now(),
            state: createPersistedOutlineState(state),
          }),
        )
      } finally {
        database.close()
      }
    },

    async clearDocument() {
      if (!globalThis.indexedDB) return
      const database = await openDatabase()
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, "readwrite")
        const store = transaction.objectStore(DOCUMENTS_STORE)
        await requestToPromise(store.delete(DEFAULT_DOCUMENT_ID))
      } finally {
        database.close()
      }
    },

    async exportBackup() {
      if (!globalThis.indexedDB) return null
      const database = await openDatabase()
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, "readonly")
        const store = transaction.objectStore(DOCUMENTS_STORE)
        const persisted = await requestToPromise<unknown>(store.get(DEFAULT_DOCUMENT_ID))
        if (!isPersistedDocument(persisted)) return null
        return createActionpadBackup(persisted, {
          exportedAt: now(),
          origin: globalThis.location?.origin ?? null,
        })
      } finally {
        database.close()
      }
    },

    async importBackup(backup) {
      if (!globalThis.indexedDB) {
        throw new Error("IndexedDB is unavailable.")
      }
      const persistedDocument = getPersistedDocumentFromBackup(backup)
      if (!persistedDocument) {
        throw new Error("This is not a valid Actionpad backup.")
      }

      const database = await openDatabase()
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, "readwrite")
        const store = transaction.objectStore(DOCUMENTS_STORE)
        await requestToPromise(store.put({ ...persistedDocument, savedAt: now() }))
        return persistedDocument.state
      } finally {
        database.close()
      }
    },
  }
}
