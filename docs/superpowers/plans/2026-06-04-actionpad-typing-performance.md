# Actionpad Typing Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make typing in a large Actionpad document scale with the edited bullet instead of the full document.

**Architecture:** First remove full-state cloning and full undo snapshots from the `update-text` hot path while keeping structural operations on the existing snapshot undo path. Then split stable actions from outline state and make visible rows memoizable so unrelated bullets, backup controls, drag wiring, and most side-panel work do not re-render on every character.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library.

---

## File Map

- Modify `src/domain/types.ts`: replace the undo stack item type with a discriminated union that supports lightweight text edits and legacy full snapshots.
- Modify `src/domain/treeOps.ts`: make `updateNodeText` copy only `state.nodes` and the edited node.
- Modify `src/store/outlineReducer.ts`: add text-edit undo coalescing, snapshot undo wrappers for structural actions, and legacy undo compatibility.
- Modify `src/store/outlineReducer.test.ts`: add identity, coalescing, and undo regression tests.
- Create `src/store/OutlineActionsContext.ts`: stable action-only context and hook.
- Create `src/store/OutlineStateContext.ts`: state-only context and hook.
- Modify `src/store/OutlineStore.tsx`: provide split contexts, keep runtime actions stable via a state ref, and retain the current combined context only as a compatibility layer.
- Modify `src/store/useOutlineStore.ts`: keep existing behavior for compatibility while new code imports focused hooks from their context files.
- Modify `src/components/OutlineView.tsx`: build row view models and pass row-local props to memoized rows.
- Modify `src/components/BulletRow.tsx`: stop subscribing to whole state, accept row props, use stable actions, and rely on previous/next visible ids from `OutlineView`.
- Create `src/domain/outlineRowDerivations.ts`: move whole-state row metadata helpers out of `BulletRow` so `OutlineView` can compute exact row props without each row subscribing to global state.
- Modify `src/components/BackupControls.tsx` and `src/components/DragLayer.tsx`: consume action-only context.
- Modify `src/components/SidePanel.tsx`: consume state and actions separately.
- Modify `src/components/OutlineView.test.tsx`: add render-count coverage for typing in one row.
- Modify `src/store/OutlineStore.fastRefresh.test.ts`: verify Fast Refresh still preserves state after context splitting.

## Task 1: Hot-Path Text Update Identity

**Files:**
- Modify: `src/domain/treeOps.ts`
- Modify: `src/store/outlineReducer.test.ts`

- [ ] **Step 1: Add a reducer identity regression test**

Add this helper near the top of `src/store/outlineReducer.test.ts`:

```ts
import type { BulletNode, OutlineState } from "../domain/types"

function createFlatState(count: number): OutlineState {
  const nodes: Record<string, BulletNode> = {}
  const rootIds: string[] = []

  for (let index = 0; index < count; index += 1) {
    const id = `node-${index}`
    rootIds.push(id)
    nodes[id] = {
      id,
      parentId: null,
      children: [],
      text: `Text ${index}`,
      collapsed: false,
      runStatus: "idle",
      metadata: {},
    }
  }

  return {
    rootIds,
    nodes,
    focusedNodeId: "node-0",
    selectedThreadId: null,
    chatFocusRequest: 0,
    panelOpen: false,
    threads: {},
    runs: {},
    undoStack: [],
  }
}
```

Add this test in the `outlineReducer` suite:

```ts
it("updates text without cloning unrelated document objects", () => {
  const state = createFlatState(50)
  const next = outlineReducer(state, {
    type: "update-text",
    nodeId: "node-0",
    text: "Changed",
  })

  expect(next).not.toBe(state)
  expect(next.nodes).not.toBe(state.nodes)
  expect(next.nodes["node-0"]).not.toBe(state.nodes["node-0"])
  expect(next.nodes["node-0"].text).toBe("Changed")
  expect(next.nodes["node-1"]).toBe(state.nodes["node-1"])
  expect(next.rootIds).toBe(state.rootIds)
  expect(next.threads).toBe(state.threads)
  expect(next.runs).toBe(state.runs)
})
```

- [ ] **Step 2: Run the identity test and verify it fails**

Run:

```bash
npx vitest run src/store/outlineReducer.test.ts --environment jsdom
```

Expected: the new identity test fails because `updateNodeText` currently calls `cloneState`, which clones every node and the top-level thread/run maps.

- [ ] **Step 3: Make `updateNodeText` path-copy only the edited node**

Replace `updateNodeText` in `src/domain/treeOps.ts` with:

```ts
export function updateNodeText(state: OutlineState, nodeId: BulletId, text: string): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  if (node.text === text) return state

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...node,
        text,
      },
    },
  }
}
```

Keep `cloneState` for structural tree operations.

- [ ] **Step 4: Verify the identity test passes**

Run:

```bash
npx vitest run src/store/outlineReducer.test.ts --environment jsdom
```

Expected: all reducer tests pass, including the new object identity assertions.

## Task 2: Lightweight Text Undo

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/store/outlineReducer.ts`
- Modify: `src/store/outlineReducer.test.ts`
- Modify: `src/components/BulletRow.tsx`

- [ ] **Step 1: Add focused undo tests before changing types**

Add these tests to `src/store/outlineReducer.test.ts`:

```ts
it("stores one lightweight undo entry for consecutive text edits on the same node", () => {
  const initial = createFlatState(5)
  const first = outlineReducer(initial, {
    type: "update-text",
    nodeId: "node-0",
    text: "A",
  })
  const second = outlineReducer(first, {
    type: "update-text",
    nodeId: "node-0",
    text: "AB",
  })

  expect(second.nodes["node-0"].text).toBe("AB")
  expect(second.undoStack).toHaveLength(1)
  expect(second.undoStack[0]).toEqual({
    kind: "text-edit",
    nodeId: "node-0",
    previousText: "Text 0",
    nextText: "AB",
    focusedNodeId: "node-0",
  })
})

it("undoes a coalesced text edit without replacing unrelated node objects", () => {
  const initial = createFlatState(5)
  const edited = outlineReducer(
    outlineReducer(initial, {
      type: "update-text",
      nodeId: "node-0",
      text: "A",
    }),
    {
      type: "update-text",
      nodeId: "node-0",
      text: "AB",
    },
  )

  const undone = outlineReducer(edited, { type: "undo" })

  expect(undone.nodes["node-0"].text).toBe("Text 0")
  expect(undone.undoStack).toHaveLength(0)
  expect(undone.nodes["node-1"]).toBe(edited.nodes["node-1"])
  expect(undone.threads).toBe(edited.threads)
  expect(undone.runs).toBe(edited.runs)
})

it("keeps structural undo entries as full snapshots", () => {
  const initial = createFlatState(2)
  const next = outlineReducer(initial, {
    type: "insert-sibling-after",
    afterNodeId: "node-0",
    id: "new-node",
    text: "",
  })

  expect(next.undoStack).toHaveLength(1)
  expect(next.undoStack[0].kind).toBe("snapshot")
})
```

- [ ] **Step 2: Run the undo tests and verify they fail**

Run:

```bash
npx vitest run src/store/outlineReducer.test.ts --environment jsdom
```

Expected: the new undo tests fail because undo entries are currently raw full snapshots.

- [ ] **Step 3: Introduce an undo entry union**

In `src/domain/types.ts`, add:

```ts
export type SnapshotUndoEntry = {
  kind: "snapshot"
  snapshot: OutlineUndoSnapshot
  focusedNodeId: BulletId | null
}

export type TextEditUndoEntry = {
  kind: "text-edit"
  nodeId: BulletId
  previousText: string
  nextText: string
  focusedNodeId: BulletId | null
}

export type OutlineUndoEntry = SnapshotUndoEntry | TextEditUndoEntry | OutlineUndoSnapshot
```

Then change `OutlineState` to:

```ts
export type OutlineState = OutlineUndoSnapshot & {
  undoStack: OutlineUndoEntry[]
}
```

The raw `OutlineUndoSnapshot` union member keeps already-persisted documents undoable after hydration.

- [ ] **Step 4: Wrap structural snapshots and restore both new and legacy entries**

In `src/store/outlineReducer.ts`, import `OutlineUndoEntry`:

```ts
import type {
  BulletDraft,
  BulletId,
  OutlineState,
  OutlineUndoEntry,
  OutlineUndoSnapshot,
  ThreadId,
} from "../domain/types"
```

Replace `restoreUndoSnapshot` and `withUndo` with:

```ts
function createSnapshotUndoEntry(state: OutlineState): OutlineUndoEntry {
  return {
    kind: "snapshot",
    snapshot: createUndoSnapshot(state),
    focusedNodeId: state.focusedNodeId,
  }
}

function restoreSnapshotUndoEntry(
  snapshot: OutlineUndoSnapshot,
  undoStack: OutlineUndoEntry[],
): OutlineState {
  return {
    ...createUndoSnapshot({ ...snapshot, undoStack: [] }),
    undoStack,
  }
}

function isSnapshotUndoEntry(entry: OutlineUndoEntry): entry is Extract<OutlineUndoEntry, { kind: "snapshot" }> {
  return "kind" in entry && entry.kind === "snapshot"
}

function isTextEditUndoEntry(entry: OutlineUndoEntry): entry is Extract<OutlineUndoEntry, { kind: "text-edit" }> {
  return "kind" in entry && entry.kind === "text-edit"
}

function restoreUndoEntry(
  state: OutlineState,
  entry: OutlineUndoEntry,
  undoStack: OutlineUndoEntry[],
): OutlineState {
  if (isTextEditUndoEntry(entry)) {
    const node = state.nodes[entry.nodeId]
    if (!node) return { ...state, undoStack }
    return {
      ...state,
      focusedNodeId: entry.focusedNodeId,
      nodes: {
        ...state.nodes,
        [entry.nodeId]: {
          ...node,
          text: entry.previousText,
        },
      },
      undoStack,
    }
  }

  return restoreSnapshotUndoEntry(isSnapshotUndoEntry(entry) ? entry.snapshot : entry, undoStack)
}

function withSnapshotUndo(state: OutlineState, next: OutlineState): OutlineState {
  if (next === state) return state
  return {
    ...next,
    undoStack: [...state.undoStack.slice(-(UNDO_LIMIT - 1)), createSnapshotUndoEntry(state)],
  }
}
```

- [ ] **Step 5: Add text-edit coalescing**

Add this helper in `src/store/outlineReducer.ts`:

```ts
function withTextUndo(
  state: OutlineState,
  nodeId: BulletId,
  next: OutlineState,
): OutlineState {
  if (next === state) return state
  const previousNode = state.nodes[nodeId]
  const nextNode = next.nodes[nodeId]
  if (!previousNode || !nextNode) return next

  const previousUndoStack = state.undoStack
  const lastEntry = previousUndoStack[previousUndoStack.length - 1]
  const coalescesWithLast =
    lastEntry &&
    isTextEditUndoEntry(lastEntry) &&
    lastEntry.nodeId === nodeId &&
    lastEntry.focusedNodeId === state.focusedNodeId

  if (coalescesWithLast) {
    const replacement: OutlineUndoEntry = {
      ...lastEntry,
      nextText: nextNode.text,
    }
    const undoStack =
      replacement.previousText === replacement.nextText
        ? previousUndoStack.slice(0, -1)
        : [...previousUndoStack.slice(0, -1), replacement]
    return { ...next, undoStack }
  }

  return {
    ...next,
    undoStack: [
      ...previousUndoStack.slice(-(UNDO_LIMIT - 1)),
      {
        kind: "text-edit",
        nodeId,
        previousText: previousNode.text,
        nextText: nextNode.text,
        focusedNodeId: state.focusedNodeId,
      },
    ],
  }
}
```

Change the reducer cases:

```ts
case "update-text":
  return withTextUndo(state, action.nodeId, updateNodeText(state, action.nodeId, action.text))
case "undo": {
  const entry = state.undoStack[state.undoStack.length - 1]
  if (!entry) return state
  return restoreUndoEntry(state, entry, state.undoStack.slice(0, -1))
}
```

Rename the old structural helper call sites from `withUndo(...)` to `withSnapshotUndo(...)`.

- [ ] **Step 6: Update terminal run undo-stack synchronization**

`syncTerminalRunIntoUndoStack` currently assumes every undo entry is a full snapshot. Change its return type and entry handling:

```ts
function syncTerminalRunIntoUndoStack(state: OutlineState, runId: RunId): OutlineUndoEntry[] {
  const run = state.runs[runId]
  if (!run) return state.undoStack
  const node = state.nodes[run.nodeId]
  const thread = state.threads[run.threadId]

  function syncSnapshot(snapshot: OutlineUndoSnapshot): OutlineUndoSnapshot {
    const snapshotNode = snapshot.nodes[run.nodeId]
    const snapshotThread = snapshot.threads[run.threadId]
    const mentionsRun =
      Boolean(snapshot.runs[runId]) ||
      snapshotNode?.activeRunId === runId ||
      snapshotThread?.runs.includes(runId)

    if (!mentionsRun) return snapshot

    return {
      ...snapshot,
      nodes: snapshotNode
        ? {
            ...snapshot.nodes,
            [run.nodeId]: {
              ...snapshotNode,
              runStatus: node?.runStatus ?? snapshotNode.runStatus,
              threadId: node?.threadId ?? snapshotNode.threadId,
              activeRunId: node?.activeRunId,
            },
          }
        : snapshot.nodes,
      threads: thread
        ? {
            ...snapshot.threads,
            [run.threadId]: cloneThread(thread),
          }
        : snapshot.threads,
      runs: {
        ...snapshot.runs,
        [runId]: { ...run, providerMetadata: { ...run.providerMetadata } },
      },
    }
  }

  return state.undoStack.map((entry) => {
    if (isTextEditUndoEntry(entry)) return entry
    if (isSnapshotUndoEntry(entry)) {
      return { ...entry, snapshot: syncSnapshot(entry.snapshot) }
    }
    return syncSnapshot(entry)
  })
}
```

- [ ] **Step 7: Confirm BulletRow undo focus lookup still type-checks**

The existing lookup should continue to work because every undo entry variant has `focusedNodeId`:

```ts
const restoredNodeId = state.undoStack[state.undoStack.length - 1]?.focusedNodeId
```

After the row subscription refactor in later tasks, move this lookup into an `onUndo` action or pass the focus target from the row view model.

- [ ] **Step 8: Verify reducer and type checks**

Run:

```bash
npx vitest run src/store/outlineReducer.test.ts --environment jsdom
npm run lint
```

Expected: reducer tests and TypeScript pass.

## Task 3: Stable Action Context

**Files:**
- Create: `src/store/OutlineActionsContext.ts`
- Create: `src/store/OutlineStateContext.ts`
- Modify: `src/store/OutlineStore.tsx`
- Modify: `src/store/useOutlineStore.ts`
- Modify: `src/components/BackupControls.tsx`
- Modify: `src/components/DragLayer.tsx`

- [ ] **Step 1: Create action-only and state-only contexts**

Create `src/store/OutlineActionsContext.ts`:

```ts
import { createContext, useContext, type Dispatch } from "react"
import type { BulletId } from "../domain/types"
import type { FilesystemListResponse, FilesystemReadResponse } from "../domain/runtimeProtocol"
import type { ActionpadBackup } from "../persistence/documentPersistence"
import type { OutlineAction } from "./outlineReducer"

export type OutlineActions = {
  dispatch: Dispatch<OutlineAction>
  executeNode: (nodeId: BulletId) => void
  sendChatMessage: (threadId: string, message: string) => void
  cancelRun: (runId: string) => void
  exportBackup: () => Promise<ActionpadBackup | null>
  importBackup: (backup: unknown) => Promise<void>
  listFilesystem: (path?: string | null, query?: string) => Promise<FilesystemListResponse>
  openDocument: (path: string) => void
  loadPanelDocument: (path: string) => Promise<FilesystemReadResponse>
  setPanelDocumentLoaded: (path: string, content: string) => void
  setPanelDocumentError: (path: string, error: string) => void
  clearPanelDocument: () => void
}

export const OutlineActionsContext = createContext<OutlineActions | null>(null)

export function useOutlineActions(): OutlineActions {
  const value = useContext(OutlineActionsContext)
  if (!value) throw new Error("useOutlineActions must be used inside OutlineStoreProvider")
  return value
}
```

Create `src/store/OutlineStateContext.ts`:

```ts
import { createContext, useContext } from "react"
import type { OutlineState } from "../domain/types"

export const OutlineStateContext = createContext<OutlineState | null>(null)

export function useOutlineState(): OutlineState {
  const value = useContext(OutlineStateContext)
  if (!value) throw new Error("useOutlineState must be used inside OutlineStoreProvider")
  return value
}
```

- [ ] **Step 2: Make runtime actions read from a state ref**

In `src/store/OutlineStore.tsx`, add:

```ts
const stateRef = useRef(state)

useEffect(() => {
  stateRef.current = state
}, [state])
```

Change `executeNode` and `sendChatMessage` to have empty dependency arrays and read `const state = stateRef.current` at the top of each callback.

- [ ] **Step 3: Provide split contexts**

In `src/store/OutlineStore.tsx`, create:

```ts
const actions = useMemo(
  () => ({
    dispatch,
    executeNode,
    sendChatMessage,
    cancelRun,
    exportBackup,
    importBackup,
    listFilesystem,
    openDocument,
    loadPanelDocument,
    setPanelDocumentLoaded,
    setPanelDocumentError,
    clearPanelDocument,
  }),
  [
    executeNode,
    sendChatMessage,
    cancelRun,
    exportBackup,
    importBackup,
    listFilesystem,
    openDocument,
    loadPanelDocument,
    setPanelDocumentLoaded,
    setPanelDocumentError,
    clearPanelDocument,
  ],
)
```

Wrap the existing provider return:

```tsx
return (
  <OutlineActionsContext.Provider value={actions}>
    <OutlineStateContext.Provider value={state}>
      <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>
    </OutlineStateContext.Provider>
  </OutlineActionsContext.Provider>
)
```

Keep the old combined `value` for components not yet migrated and for test compatibility.

- [ ] **Step 4: Move action-only consumers**

In `src/components/BackupControls.tsx`, replace:

```ts
const { exportBackup, importBackup } = useOutlineStore()
```

with:

```ts
const { exportBackup, importBackup } = useOutlineActions()
```

In `src/components/DragLayer.tsx`, replace:

```ts
const { dispatch } = useOutlineStore()
```

with:

```ts
const { dispatch } = useOutlineActions()
```

- [ ] **Step 5: Verify split contexts**

Run:

```bash
npx vitest run src/store/OutlineStore.fastRefresh.test.ts src/components/OutlineView.test.tsx --environment jsdom
npm run lint
```

Expected: tests and TypeScript pass.

## Task 4: Memoized Row Rendering

**Files:**
- Modify: `src/components/OutlineView.tsx`
- Modify: `src/components/BulletRow.tsx`
- Create: `src/domain/outlineRowDerivations.ts`
- Modify: `src/components/OutlineView.test.tsx`
- Modify: `src/domain/visibleTree.ts`

- [ ] **Step 1: Add row render-count regression coverage**

In `src/components/OutlineView.test.tsx`, add a test-only render counter hook by mocking or exporting a counter from `BulletRow` only under `import.meta.env.MODE === "test"`. The expected behavior after this task is:

```ts
it("does not re-render unrelated rows when one bullet text changes", async () => {
  const user = userEvent.setup()
  const initialState = createFlatState(30)

  render(<App initialState={initialState} persistence={null} />)

  const firstInput = screen.getByLabelText("Bullet text: Text 0")
  await user.clear(firstInput)
  await user.type(firstInput, "Changed")

  expect(getBulletRowRenderCount("node-0")).toBeGreaterThan(1)
  expect(getBulletRowRenderCount("node-20")).toBe(1)
})
```

Add the render counter as a test-only module export from `src/components/BulletRow.tsx`:

```ts
export const bulletRowRenderCounts =
  import.meta.env.MODE === "test" ? new Map<BulletId, number>() : null

export function getBulletRowRenderCount(nodeId: BulletId): number {
  return bulletRowRenderCounts?.get(nodeId) ?? 0
}
```

At the top of the memoized row body, increment it:

```ts
if (bulletRowRenderCounts) {
  bulletRowRenderCounts.set(node.id, getBulletRowRenderCount(node.id) + 1)
}
```

- [ ] **Step 2: Change `OutlineView` to pass row-local props**

Build row models from the current state:

```ts
type RowModel = {
  id: BulletId
  depth: number
  previousVisibleNodeId: BulletId | null
  nextVisibleNodeId: BulletId | null
  unreadState: BulletUnreadState
  unreadDescendantPath: BulletId[] | null
  hiddenRunningDescendantCount: number
  hasGeneratedChildOutput: boolean
  hoverTitle: string
}

function getRowModels(state: OutlineState): RowModel[] {
  const rows = getVisibleRows(state)
  return rows.map((row, index) => ({
    id: row.id,
    depth: row.depth,
    previousVisibleNodeId: rows[index - 1]?.id ?? null,
    nextVisibleNodeId: rows[index + 1]?.id ?? null,
    unreadState: getBulletUnreadState(state, row.id),
    unreadDescendantPath: findFirstUnreadDescendantPath(state, row.id),
    hiddenRunningDescendantCount: getHiddenRunningDescendantCount(state, row.id),
    hasGeneratedChildOutput: hasGeneratedChildOutput(state, row.id),
    hoverTitle: getBulletHoverTitle(state, row.id),
  }))
}
```

Render:

```tsx
{rows.map((row) => (
  <BulletRow
    key={row.id}
    node={state.nodes[row.id]}
    depth={row.depth}
    focused={state.focusedNodeId === row.id}
    previousVisibleNodeId={row.previousVisibleNodeId}
    nextVisibleNodeId={row.nextVisibleNodeId}
    unreadState={row.unreadState}
    unreadDescendantPath={row.unreadDescendantPath}
    hiddenRunningDescendantCount={row.hiddenRunningDescendantCount}
    hasGeneratedChildOutput={row.hasGeneratedChildOutput}
    hoverTitle={row.hoverTitle}
  />
))}
```

- [ ] **Step 3: Convert `BulletRow` to props plus stable actions**

Change props:

```ts
type BulletRowProps = {
  node: BulletNode
  depth: number
  focused: boolean
  previousVisibleNodeId: BulletId | null
  nextVisibleNodeId: BulletId | null
  unreadState: BulletUnreadState
  unreadDescendantPath: BulletId[] | null
  hiddenRunningDescendantCount: number
  hasGeneratedChildOutput: boolean
  hoverTitle: string
}
```

Inside `BulletRow`, replace whole-store usage with:

```ts
const {
  dispatch,
  executeNode,
  listFilesystem,
  openDocument,
  clearPanelDocument,
} = useOutlineActions()
const nodeId = node.id
```

For delete/backspace and arrow navigation, use the passed adjacent ids instead of `getAdjacentVisibleNodeId(state, ...)`.

- [ ] **Step 4: Move whole-state row derivations out of `BulletRow`**

Create `src/domain/outlineRowDerivations.ts` and move these helpers from `BulletRow` into it:

```ts
export function getHiddenRunningDescendantCount(state: OutlineState, nodeId: BulletId): number
export function findFirstUnreadDescendantPath(state: OutlineState, nodeId: BulletId): BulletId[] | null
export function hasGeneratedChildOutput(state: OutlineState, nodeId: BulletId): boolean
export function getBulletHoverTitle(state: OutlineState, nodeId: BulletId): string
```

Keep their implementations unchanged in this task. This preserves current row behavior while removing the row's whole-state context subscription. The later cached-index task can make these derivations cheaper.

- [ ] **Step 5: Memoize `BulletRow`**

Export the component through `React.memo`:

```ts
export const BulletRow = memo(function BulletRow({
  node,
  depth,
  focused,
  previousVisibleNodeId,
  nextVisibleNodeId,
}: BulletRowProps) {
  // existing row body
}, areBulletRowPropsEqual)

function areBulletRowPropsEqual(previous: BulletRowProps, next: BulletRowProps): boolean {
  return (
    previous.node === next.node &&
    previous.depth === next.depth &&
    previous.focused === next.focused &&
    previous.previousVisibleNodeId === next.previousVisibleNodeId &&
    previous.nextVisibleNodeId === next.nextVisibleNodeId &&
    previous.unreadState === next.unreadState &&
    previous.hiddenRunningDescendantCount === next.hiddenRunningDescendantCount &&
    previous.hasGeneratedChildOutput === next.hasGeneratedChildOutput &&
    previous.hoverTitle === next.hoverTitle &&
    pathsEqual(previous.unreadDescendantPath, next.unreadDescendantPath)
  )
}

function pathsEqual(left: BulletId[] | null, right: BulletId[] | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}
```

- [ ] **Step 6: Verify row render behavior**

Run:

```bash
npx vitest run src/components/OutlineView.test.tsx --environment jsdom
npm run lint
```

Expected: the render-count test passes and TypeScript reports no errors.

## Task 5: Side Panel State/Action Split

**Files:**
- Modify: `src/components/SidePanel.tsx`
- Modify: `src/components/SidePanel.test.tsx`

- [ ] **Step 1: Replace combined store usage in `SidePanel`**

Use:

```ts
const state = useOutlineState()
const {
  dispatch,
  executeNode,
  sendChatMessage,
  cancelRun,
  loadPanelDocument,
  setPanelDocumentLoaded,
  setPanelDocumentError,
  clearPanelDocument,
} = useOutlineActions()
```

Keep existing behavior for selected thread, focused thread, resize, document loading, and close-panel focus restore.

- [ ] **Step 2: Verify side panel behavior**

Run:

```bash
npx vitest run src/components/SidePanel.test.tsx --environment jsdom
npm run lint
```

Expected: existing side panel tests pass.

## Task 6: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/store/outlineReducer.test.ts src/store/OutlineStore.fastRefresh.test.ts src/components/OutlineView.test.tsx src/components/SidePanel.test.tsx --environment jsdom
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Manual smoke test in a large outline**

Run:

```bash
npm run dev
```

Open the local Vite URL, paste or import a large outline, and type into a top-level bullet. Expected: typing remains responsive; unrelated visible rows do not visibly repaint; undo restores the previous text burst; structural undo still restores inserted/deleted/moved bullets.

## Notes For Follow-Up Work

- The row memoization task intentionally does not solve cached descendant/run metadata. That is the next likely performance task after these two fixes.
- Persistence still saves the whole state. After lightweight text undo lands, add a separate persistence compaction task that omits undo stack from saved documents.
- Row virtualization is still useful for very large outlines, but should come after this plan so it is not masking reducer and subscription costs.
