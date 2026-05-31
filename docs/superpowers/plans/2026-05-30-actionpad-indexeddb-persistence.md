# Actionpad IndexedDB Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the current Actionpad document snapshot in browser IndexedDB so reloads restore bullets, chats, runs, events, and undo state.

**Architecture:** Add a small browser persistence boundary that exposes `loadDocument`, `saveDocument`, and `clearDocument`. The React store keeps using the reducer for instant local edits, hydrates once from IndexedDB after mount, then debounces full-state snapshot saves after reducer changes. Runtime execution remains unchanged.

**Tech Stack:** React, TypeScript, native IndexedDB API, Vitest, Testing Library.

---

## File Map

- Create `src/persistence/documentPersistence.ts`: IndexedDB adapter, persisted document types, schema/version constants, and safe load/save/clear helpers.
- Create `src/persistence/documentPersistence.test.ts`: tests for unavailable IndexedDB fallback and schema validation behavior.
- Modify `src/store/outlineReducer.ts`: add a `hydrate-state` action that replaces reducer state with a loaded `OutlineState`.
- Modify `src/store/outlineReducer.test.ts`: prove hydrate replaces state without adding undo history.
- Modify `src/store/OutlineStore.tsx`: load persisted state once, skip saving until hydration finishes, debounce saves, and inject persistence in tests.
- Modify `src/App.tsx`: pass through optional test-only persistence prop.
- Modify `src/components/OutlineView.test.tsx`: verify persisted state hydrates visible UI and edits trigger debounced saves.

## Task 1: Persistence Boundary

**Files:**
- Create: `src/persistence/documentPersistence.ts`
- Create: `src/persistence/documentPersistence.test.ts`

- [ ] **Step 1: Add persistence types and native IndexedDB helpers**

Create `src/persistence/documentPersistence.ts` with this API:

```ts
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
```

Implement native IndexedDB helpers:

```ts
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
```

Expose:

```ts
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
```

Use a light validator:

```ts
function isPersistedDocument(value: unknown): value is PersistedDocument {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const state = record.state as Record<string, unknown> | undefined
  return (
    record.id === DEFAULT_DOCUMENT_ID &&
    record.schemaVersion === PERSISTED_DOCUMENT_SCHEMA_VERSION &&
    typeof record.savedAt === "number" &&
    Boolean(state) &&
    Array.isArray(state.rootIds) &&
    typeof state.nodes === "object" &&
    state.nodes !== null &&
    Array.isArray(state.undoStack)
  )
}
```

- [ ] **Step 2: Add focused persistence tests**

Create tests for unavailable IndexedDB and invalid persisted document shape. Export the validator as `isPersistedDocument` so schema-version behavior can be tested without building a full IndexedDB mock.

Minimum assertions:

```ts
import { describe, expect, it, vi } from "vitest"
import { createInitialOutlineState } from "../domain/fixtures"
import { createIndexedDbDocumentPersistence, isPersistedDocument } from "./documentPersistence"

describe("documentPersistence", () => {
  it("returns null when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB
    vi.stubGlobal("indexedDB", undefined)

    await expect(createIndexedDbDocumentPersistence().loadDocument()).resolves.toBeNull()
    await expect(createIndexedDbDocumentPersistence().saveDocument(createInitialOutlineState()))
      .resolves.toBeUndefined()

    vi.stubGlobal("indexedDB", original)
  })

  it("rejects unsupported schema versions", () => {
    expect(
      isPersistedDocument({
        id: "default",
        schemaVersion: 999,
        savedAt: 100,
        state: createInitialOutlineState(),
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 3: Verify Task 1**

Run:

```bash
npx vitest run src/persistence/documentPersistence.test.ts --environment jsdom
```

Expected: tests pass.

## Task 2: Reducer Hydration

**Files:**
- Modify: `src/store/outlineReducer.ts`
- Modify: `src/store/outlineReducer.test.ts`

- [ ] **Step 1: Add a hydrate action**

Extend `OutlineAction`:

```ts
| { type: "hydrate-state"; state: OutlineState }
```

Add a reducer case near the top:

```ts
case "hydrate-state":
  return action.state
```

This action intentionally does not call `withUndo`; persisted state already contains its own undo stack.

- [ ] **Step 2: Add reducer test**

Add to `src/store/outlineReducer.test.ts`:

```ts
it("hydrates from a persisted outline state without adding undo history", () => {
  const state = createInitialOutlineState()
  const persisted = {
    ...state,
    focusedNodeId: "root",
    nodes: {
      ...state.nodes,
      root: {
        ...state.nodes.root,
        text: "Persisted document",
      },
    },
    undoStack: [],
  }

  const next = outlineReducer(createInitialOutlineState(), {
    type: "hydrate-state",
    state: persisted,
  })

  expect(next.nodes.root.text).toBe("Persisted document")
  expect(next.undoStack).toEqual([])
})
```

If `src/store/outlineReducer.test.ts` currently imports a seeded fixture as `createInitialOutlineState`, add a separate import alias for the real empty fixture:

```ts
import { createInitialOutlineState as createEmptyOutlineState } from "../domain/fixtures"
```

Then use `createEmptyOutlineState()` in this hydration test.

- [ ] **Step 3: Verify Task 2**

Run:

```bash
npx vitest run src/store/outlineReducer.test.ts --environment jsdom
```

Expected: tests pass.

## Task 3: Store Load And Debounced Save

**Files:**
- Modify: `src/store/OutlineStore.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/OutlineView.test.tsx`

- [ ] **Step 1: Inject persistence into the store**

Update imports:

```ts
import {
  createIndexedDbDocumentPersistence,
  type DocumentPersistence,
} from "../persistence/documentPersistence"
```

Extend `OutlineStoreProvider` props:

```ts
export function OutlineStoreProvider({
  children,
  initialState,
  persistence = createIndexedDbDocumentPersistence(),
}: {
  children: ReactNode
  initialState?: OutlineState
  persistence?: DocumentPersistence | null
}) {
```

Keep `persistence: null` available for tests that should not save.

- [ ] **Step 2: Load persisted state once**

Add refs:

```ts
const persistenceRef = useRef(persistence)
const hydratedRef = useRef(false)
```

Add load effect:

```ts
useEffect(() => {
  let cancelled = false

  async function loadPersistedDocument() {
    if (!persistenceRef.current || initialStateRef.current) {
      hydratedRef.current = true
      return
    }

    try {
      const persistedState = await persistenceRef.current.loadDocument()
      if (!cancelled && persistedState) {
        dispatch({ type: "hydrate-state", state: persistedState })
      }
    } catch (error) {
      console.warn("Actionpad could not load persisted document.", error)
    } finally {
      if (!cancelled) hydratedRef.current = true
    }
  }

  void loadPersistedDocument()

  return () => {
    cancelled = true
  }
}, [])
```

When `initialState` is passed for tests, skip IndexedDB hydration so old tests stay deterministic.

- [ ] **Step 3: Debounce saves after hydration**

Add save effect:

```ts
useEffect(() => {
  if (!persistenceRef.current || !hydratedRef.current || initialStateRef.current) return

  const timeout = window.setTimeout(() => {
    persistenceRef.current?.saveDocument(state).catch((error) => {
      console.warn("Actionpad could not save persisted document.", error)
    })
  }, 500)

  return () => window.clearTimeout(timeout)
}, [state])
```

This keeps editing snappy because reducer changes are immediate and persistence is best-effort.

- [ ] **Step 4: Pass persistence through App**

Modify `src/App.tsx`:

```ts
import type { DocumentPersistence } from "./persistence/documentPersistence"

export function App({
  initialState,
  persistence,
}: {
  initialState?: OutlineState
  persistence?: DocumentPersistence | null
}) {
  return (
    <OutlineStoreProvider initialState={initialState} persistence={persistence}>
```

- [ ] **Step 5: Add hydration/save component tests**

Add tests to `src/components/OutlineView.test.tsx`:

```ts
test("hydrates the outline from persisted state", async () => {
  const persisted = createSeededOutlineState()
  persisted.nodes["research-products"].text = "Persisted research"
  const persistence = {
    loadDocument: vi.fn().mockResolvedValue(persisted),
    saveDocument: vi.fn().mockResolvedValue(undefined),
    clearDocument: vi.fn().mockResolvedValue(undefined),
  }

  render(<App persistence={persistence} />)

  expect(await screen.findByDisplayValue("Persisted research")).toBeInTheDocument()
})
```

And:

```ts
test("debounces persisted saves after edits", async () => {
  vi.useFakeTimers()
  const persistence = {
    loadDocument: vi.fn().mockResolvedValue(null),
    saveDocument: vi.fn().mockResolvedValue(undefined),
    clearDocument: vi.fn().mockResolvedValue(undefined),
  }

  render(<App persistence={persistence} />)
  const bullet = screen.getByLabelText(/bullet text/i)
  fireEvent.change(bullet, { target: { value: "Saved locally" } })

  expect(persistence.saveDocument).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(500)

  expect(persistence.saveDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      nodes: expect.objectContaining({
        root: expect.objectContaining({ text: "Saved locally" }),
      }),
    }),
  )
  vi.useRealTimers()
})
```

- [ ] **Step 6: Verify Task 3**

Run:

```bash
npx vitest run src/components/OutlineView.test.tsx src/store/outlineReducer.test.ts --environment jsdom
```

Expected: tests pass.

## Task 4: Final Verification And Manual Smoke

**Files:**
- No required code files.
- May update `docs/superpowers/known-issues/2026-05-30-actionpad-indexeddb-persistence-followups.md` if non-P0 issues are found.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/persistence/documentPersistence.test.ts src/store/outlineReducer.test.ts src/components/OutlineView.test.tsx src/components/SidePanel.test.tsx --environment jsdom
```

Expected: tests pass.

- [ ] **Step 2: Run full checks**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

If running full `npm test`, use an environment that permits localhost binding because `runtime/server.test.ts` starts a local HTTP server.

- [ ] **Step 3: Browser smoke test**

With the dev server running:

1. Open `http://127.0.0.1:5173/`.
2. Type `Persist this document` into the first bullet.
3. Wait one second.
4. Reload the page.
5. Confirm the bullet still reads `Persist this document`.
6. Optionally run a fake/real bullet, wait for generated child bullets, reload, and confirm the generated children and chat icon remain.

- [ ] **Step 4: P0 self-review**

Review only for:

- Initial empty state overwritten before load completes.
- Save effect looping or blocking typing.
- Tests accidentally writing to real IndexedDB.
- Runtime execution broken by persistence changes.

Fix only P0/P1 issues. Note anything else in a follow-up doc.

- [ ] **Step 5: Commit implementation**

Commit only files related to persistence. Do not include unrelated dirty files such as `src/styles.css`.

```bash
git add src/persistence/documentPersistence.ts src/persistence/documentPersistence.test.ts src/store/OutlineStore.tsx src/store/outlineReducer.ts src/store/outlineReducer.test.ts src/App.tsx src/components/OutlineView.test.tsx
git commit -m "feat: persist actionpad document in indexeddb"
```

## Self-Review

- Spec coverage: covers IndexedDB database/store/key, one `default` document, schema version, full `OutlineState` snapshot, hydrate-on-load, 500 ms debounced save, non-blocking failures, runtime independence, and future SQLite migration boundary.
- Scope check: excludes SQLite, multi-doc UI, sync, event log, and version browsing as requested.
- Type consistency: `PersistedDocument`, `DocumentPersistence`, `hydrate-state`, and `OutlineState` names match the current codebase and planned imports.
