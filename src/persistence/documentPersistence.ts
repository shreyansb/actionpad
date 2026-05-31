import type { OutlineState } from "../domain/types"

export const ACTIONPAD_DB_NAME = "actionpad"
export const ACTIONPAD_DB_VERSION = 1
export const DOCUMENTS_STORE = "documents"
export const DEFAULT_DOCUMENT_ID = "default"
export const PERSISTED_DOCUMENT_SCHEMA_VERSION = 1

export type PersistedDocument = {
  id: typeof DEFAULT_DOCUMENT_ID
  schemaVersion: typeof PERSISTED_DOCUMENT_SCHEMA_VERSION
  savedAt: number
  state: OutlineState
}

export type DocumentPersistence = {
  loadDocument: () => Promise<OutlineState | null>
  saveDocument: (state: OutlineState) => Promise<void>
  clearDocument: () => Promise<void>
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
        return persisted.state
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
            state,
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
  }
}
