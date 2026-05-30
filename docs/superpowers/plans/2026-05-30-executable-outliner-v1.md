# Executable Outliner V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React/Vite prototype of a keyboard-first executable outliner with simulated bullet-level agent chats and generated child bullets.

**Architecture:** Use a small custom TypeScript domain model for normalized outline state, pure tree operations, context building, and simulated runner behavior. Render the outline and side panel with React components backed by a reducer/store so the UI can later swap in a real chat/agent harness without changing the tree model.

**Tech Stack:** React, Vite, TypeScript, Vitest, Testing Library, dnd-kit, CSS modules/plain CSS.

---

## File Structure

- Create `package.json`: project scripts and dependencies.
- Create `index.html`: Vite entry document.
- Create `vite.config.ts`: Vite + React + Vitest config.
- Create `tsconfig.json`: TypeScript compiler settings.
- Create `src/main.tsx`: React root bootstrap.
- Create `src/App.tsx`: application composition.
- Create `src/styles.css`: full app styling.
- Create `src/domain/types.ts`: shared outline, bullet, thread, event, and action types.
- Create `src/domain/fixtures.ts`: seed outline for the prototype.
- Create `src/domain/treeOps.ts`: pure structural outline operations.
- Create `src/domain/treeOps.test.ts`: tree operation tests.
- Create `src/domain/visibleTree.ts`: flatten visible tree for rendering and keyboard navigation.
- Create `src/domain/visibleTree.test.ts`: visible-tree tests.
- Create `src/domain/context.ts`: `buildRunContext`.
- Create `src/domain/context.test.ts`: context builder tests.
- Create `src/domain/runner.ts`: simulated run output generator.
- Create `src/domain/runner.test.ts`: simulated runner tests.
- Create `src/store/outlineReducer.ts`: pure reducer and action handlers.
- Create `src/store/outlineReducer.test.ts`: reducer tests.
- Create `src/store/OutlineStore.tsx`: React context, reducer provider, and async run orchestration.
- Create `src/components/OutlineView.tsx`: visible tree rendering.
- Create `src/components/BulletRow.tsx`: editable row, marker, controls, keyboard handling.
- Create `src/components/SidePanel.tsx`: selected bullet thread panel.
- Create `src/components/ChatThreadView.tsx`: messages and outline output cards.
- Create `src/components/ChatInput.tsx`: local simulated chat input.
- Create `src/components/DragLayer.tsx`: dnd-kit wrapper for row drag/reparent.
- Create `src/test/setup.ts`: Testing Library setup.

Keep domain files independent of React. Keep reducer tests separate from component tests. Do not introduce a formal slot/plugin system in V1.

---

### Task 1: Scaffold Vite React Project

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create package metadata**

Create `package.json`:

```json
{
  "name": "executable-outliner-v1",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc -b --noEmit"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.468.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "jsdom": "^24.1.1",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and install completes without errors.

- [ ] **Step 3: Create app entry files**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Executable Outliner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/main.tsx`:

```tsx
import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Create `src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <section className="outline-pane">
        <p className="empty-state">Executable Outliner V1</p>
      </section>
    </main>
  )
}
```

Create `src/styles.css`:

```css
:root {
  color: #20242a;
  background: #f7f8fa;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  background: #f7f8fa;
}

.outline-pane {
  max-width: 980px;
  margin: 0 auto;
  padding: 56px 32px;
}

.empty-state {
  color: #687080;
}
```

- [ ] **Step 4: Configure TypeScript and tests**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    globals: true,
  },
})
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
```

- [ ] **Step 5: Verify scaffold**

Run:

```bash
npm run lint
npm run build
npm test
```

Expected: typecheck and build pass; Vitest reports no test files or exits successfully once later tests exist.

- [ ] **Step 6: Commit scaffold**

```bash
git add package.json package-lock.json index.html vite.config.ts tsconfig.json src
git commit -m "chore: scaffold executable outliner app"
```

---

### Task 2: Add Domain Types And Seed Data

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/fixtures.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Define shared types**

Create `src/domain/types.ts`:

```ts
export type BulletId = string
export type ThreadId = string

export type BulletRunStatus = "idle" | "running" | "succeeded" | "failed"

export type BulletNode = {
  id: BulletId
  parentId: BulletId | null
  children: BulletId[]
  text: string
  collapsed: boolean
  runStatus: BulletRunStatus
  threadId?: ThreadId
  metadata: Record<string, unknown>
}

export type OutlineState = {
  rootIds: BulletId[]
  nodes: Record<BulletId, BulletNode>
  focusedNodeId: BulletId | null
  selectedThreadId: ThreadId | null
  panelOpen: boolean
  threads: Record<ThreadId, AgentThread>
}

export type AgentThread = {
  id: ThreadId
  nodeId: BulletId
  messages: AgentMessage[]
  events: AgentEvent[]
}

export type AgentMessage = {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt: number
  status?: "streaming" | "complete" | "error"
}

export type AgentEvent =
  | { type: "run-started"; nodeId: BulletId; createdAt: number }
  | { type: "message-created"; messageId: string; createdAt: number }
  | { type: "outline-output"; output: OutlineOutput; createdAt: number }
  | { type: "run-completed"; nodeId: BulletId; createdAt: number }

export type OutlineOutput =
  | { type: "append-child-bullets"; parentId: BulletId; bullets: BulletDraft[] }
  | { type: "update-node-status"; nodeId: BulletId; status: BulletRunStatus }

export type BulletDraft = {
  text: string
  metadata?: Record<string, unknown>
}
```

- [ ] **Step 2: Add seed outline**

Create `src/domain/fixtures.ts`:

```ts
import type { BulletNode, OutlineState } from "./types"

function bullet(
  id: string,
  text: string,
  parentId: string | null,
  children: string[] = [],
): BulletNode {
  return {
    id,
    parentId,
    children,
    text,
    collapsed: false,
    runStatus: "idle",
    metadata: {},
  }
}

export function createInitialOutlineState(): OutlineState {
  return {
    rootIds: ["root-project"],
    focusedNodeId: "research-products",
    selectedThreadId: null,
    panelOpen: false,
    threads: {},
    nodes: {
      "root-project": bullet("root-project", "Executable Outliner Prototype", null, [
        "research",
        "ui-exploration",
      ]),
      research: bullet("research", "Research", "root-project", ["research-products"]),
      "research-products": bullet(
        "research-products",
        "Find adjacent products and patterns",
        "research",
      ),
      "ui-exploration": bullet("ui-exploration", "Sketch the first interaction loop", "root-project"),
    },
  }
}
```

- [ ] **Step 3: Temporarily render seed count in App**

Modify `src/App.tsx`:

```tsx
import { createInitialOutlineState } from "./domain/fixtures"

export function App() {
  const initial = createInitialOutlineState()

  return (
    <main className="app-shell">
      <section className="outline-pane">
        <p className="empty-state">
          Executable Outliner V1 · {Object.keys(initial.nodes).length} seed bullets
        </p>
      </section>
    </main>
  )
}
```

- [ ] **Step 4: Verify types**

Run:

```bash
npm run lint
```

Expected: TypeScript exits successfully.

- [ ] **Step 5: Commit domain types**

```bash
git add src/domain src/App.tsx
git commit -m "feat: add outline domain model"
```

---

### Task 3: Implement Pure Tree Operations

**Files:**
- Create: `src/domain/treeOps.ts`
- Create: `src/domain/treeOps.test.ts`

- [ ] **Step 1: Write failing tree operation tests**

Create `src/domain/treeOps.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import {
  appendChildBullets,
  collapseNode,
  expandNode,
  indentNode,
  insertSiblingAfter,
  outdentNode,
  reparentNode,
  updateNodeText,
} from "./treeOps"

describe("treeOps", () => {
  it("updates node text without changing structure", () => {
    const state = createInitialOutlineState()
    const next = updateNodeText(state, "research-products", "Find outliner references")
    expect(next.nodes["research-products"].text).toBe("Find outliner references")
    expect(next.nodes.research.children).toEqual(["research-products"])
  })

  it("inserts a sibling after an existing node", () => {
    const state = createInitialOutlineState()
    const next = insertSiblingAfter(state, "research", {
      id: "new-sibling",
      text: "Frontend plan",
    })
    expect(next.rootIds).toEqual(["root-project"])
    expect(next.nodes["root-project"].children).toEqual(["research", "new-sibling", "ui-exploration"])
    expect(next.nodes["new-sibling"].parentId).toBe("root-project")
  })

  it("indents a node under its previous sibling", () => {
    const state = createInitialOutlineState()
    const next = indentNode(state, "ui-exploration")
    expect(next.nodes["ui-exploration"].parentId).toBe("research")
    expect(next.nodes.research.children).toEqual(["research-products", "ui-exploration"])
    expect(next.nodes["root-project"].children).toEqual(["research"])
  })

  it("outdents a node to its grandparent after its parent", () => {
    const state = createInitialOutlineState()
    const next = outdentNode(state, "research-products")
    expect(next.nodes["research-products"].parentId).toBe("root-project")
    expect(next.nodes["root-project"].children).toEqual([
      "research",
      "research-products",
      "ui-exploration",
    ])
    expect(next.nodes.research.children).toEqual([])
  })

  it("reparents a node as the last child of a target parent", () => {
    const state = createInitialOutlineState()
    const next = reparentNode(state, "ui-exploration", "research")
    expect(next.nodes["ui-exploration"].parentId).toBe("research")
    expect(next.nodes.research.children).toEqual(["research-products", "ui-exploration"])
  })

  it("prevents reparenting a node under its own descendant", () => {
    const state = createInitialOutlineState()
    const next = reparentNode(state, "research", "research-products")
    expect(next).toBe(state)
  })

  it("appends generated child bullets", () => {
    const state = createInitialOutlineState()
    const next = appendChildBullets(state, "research-products", [
      { id: "generated-1", text: "Workflowy is a close UI reference." },
      { id: "generated-2", text: "Taskade is a close agent-task reference." },
    ])
    expect(next.nodes["research-products"].children).toEqual(["generated-1", "generated-2"])
    expect(next.nodes["generated-1"].metadata.generated).toBe(true)
  })

  it("collapses and expands nodes", () => {
    const state = createInitialOutlineState()
    expect(collapseNode(state, "research").nodes.research.collapsed).toBe(true)
    expect(expandNode(collapseNode(state, "research"), "research").nodes.research.collapsed).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/domain/treeOps.test.ts
```

Expected: FAIL because `src/domain/treeOps.ts` does not exist.

- [ ] **Step 3: Implement tree operations**

Create `src/domain/treeOps.ts`:

```ts
import type { BulletDraft, BulletId, BulletNode, OutlineState } from "./types"

type DraftWithId = BulletDraft & { id: BulletId }

function cloneState(state: OutlineState): OutlineState {
  return {
    ...state,
    rootIds: [...state.rootIds],
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, node]) => [
        id,
        { ...node, children: [...node.children], metadata: { ...node.metadata } },
      ]),
    ),
    threads: { ...state.threads },
  }
}

function siblingsFor(state: OutlineState, nodeId: BulletId): BulletId[] {
  const parentId = state.nodes[nodeId]?.parentId
  return parentId ? state.nodes[parentId].children : state.rootIds
}

function replaceSiblings(state: OutlineState, parentId: BulletId | null, siblings: BulletId[]) {
  if (parentId) {
    state.nodes[parentId].children = siblings
  } else {
    state.rootIds = siblings
  }
}

function createBullet(id: BulletId, parentId: BulletId | null, text: string, metadata = {}): BulletNode {
  return {
    id,
    parentId,
    children: [],
    text,
    collapsed: false,
    runStatus: "idle",
    metadata,
  }
}

function isDescendant(state: OutlineState, possibleDescendantId: BulletId, ancestorId: BulletId): boolean {
  let cursor = state.nodes[possibleDescendantId]?.parentId ?? null
  while (cursor) {
    if (cursor === ancestorId) return true
    cursor = state.nodes[cursor]?.parentId ?? null
  }
  return false
}

export function updateNodeText(state: OutlineState, nodeId: BulletId, text: string): OutlineState {
  if (!state.nodes[nodeId]) return state
  const next = cloneState(state)
  next.nodes[nodeId].text = text
  return next
}

export function insertSiblingAfter(
  state: OutlineState,
  afterNodeId: BulletId,
  draft: { id: BulletId; text: string },
): OutlineState {
  const node = state.nodes[afterNodeId]
  if (!node) return state
  const next = cloneState(state)
  const siblings = siblingsFor(next, afterNodeId)
  const index = siblings.indexOf(afterNodeId)
  const nextSiblings = [...siblings.slice(0, index + 1), draft.id, ...siblings.slice(index + 1)]
  next.nodes[draft.id] = createBullet(draft.id, node.parentId, draft.text)
  replaceSiblings(next, node.parentId, nextSiblings)
  next.focusedNodeId = draft.id
  return next
}

export function indentNode(state: OutlineState, nodeId: BulletId): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  const siblings = siblingsFor(state, nodeId)
  const index = siblings.indexOf(nodeId)
  if (index <= 0) return state

  const previousSiblingId = siblings[index - 1]
  const next = cloneState(state)
  const oldSiblings = siblingsFor(next, nodeId).filter((id) => id !== nodeId)
  replaceSiblings(next, node.parentId, oldSiblings)
  next.nodes[nodeId].parentId = previousSiblingId
  next.nodes[previousSiblingId].children.push(nodeId)
  next.nodes[previousSiblingId].collapsed = false
  return next
}

export function outdentNode(state: OutlineState, nodeId: BulletId): OutlineState {
  const node = state.nodes[nodeId]
  if (!node?.parentId) return state
  const parent = state.nodes[node.parentId]
  const next = cloneState(state)
  next.nodes[parent.id].children = next.nodes[parent.id].children.filter((id) => id !== nodeId)
  next.nodes[nodeId].parentId = parent.parentId

  const targetSiblings = parent.parentId ? next.nodes[parent.parentId].children : next.rootIds
  const parentIndex = targetSiblings.indexOf(parent.id)
  const nextSiblings = [
    ...targetSiblings.slice(0, parentIndex + 1),
    nodeId,
    ...targetSiblings.slice(parentIndex + 1),
  ]
  replaceSiblings(next, parent.parentId, nextSiblings)
  return next
}

export function reparentNode(
  state: OutlineState,
  nodeId: BulletId,
  targetParentId: BulletId | null,
): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  if (targetParentId === nodeId) return state
  if (targetParentId && isDescendant(state, targetParentId, nodeId)) return state

  const next = cloneState(state)
  const oldSiblings = siblingsFor(next, nodeId).filter((id) => id !== nodeId)
  replaceSiblings(next, node.parentId, oldSiblings)
  next.nodes[nodeId].parentId = targetParentId
  if (targetParentId) {
    next.nodes[targetParentId].children.push(nodeId)
    next.nodes[targetParentId].collapsed = false
  } else {
    next.rootIds.push(nodeId)
  }
  return next
}

export function appendChildBullets(
  state: OutlineState,
  parentId: BulletId,
  drafts: DraftWithId[],
): OutlineState {
  if (!state.nodes[parentId]) return state
  const next = cloneState(state)
  for (const draft of drafts) {
    next.nodes[draft.id] = createBullet(draft.id, parentId, draft.text, {
      generated: true,
      ...(draft.metadata ?? {}),
    })
    next.nodes[parentId].children.push(draft.id)
  }
  next.nodes[parentId].collapsed = false
  return next
}

export function collapseNode(state: OutlineState, nodeId: BulletId): OutlineState {
  if (!state.nodes[nodeId]) return state
  const next = cloneState(state)
  next.nodes[nodeId].collapsed = true
  return next
}

export function expandNode(state: OutlineState, nodeId: BulletId): OutlineState {
  if (!state.nodes[nodeId]) return state
  const next = cloneState(state)
  next.nodes[nodeId].collapsed = false
  return next
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/domain/treeOps.test.ts
npm run lint
```

Expected: all tree operation tests pass and TypeScript passes.

- [ ] **Step 5: Commit tree operations**

```bash
git add src/domain/treeOps.ts src/domain/treeOps.test.ts
git commit -m "feat: add outline tree operations"
```

---

### Task 4: Add Visible Tree Flattening

**Files:**
- Create: `src/domain/visibleTree.ts`
- Create: `src/domain/visibleTree.test.ts`

- [ ] **Step 1: Write failing visible tree tests**

Create `src/domain/visibleTree.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import { collapseNode } from "./treeOps"
import { getVisibleRows } from "./visibleTree"

describe("getVisibleRows", () => {
  it("flattens the tree with depth", () => {
    const rows = getVisibleRows(createInitialOutlineState())
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ["root-project", 0],
      ["research", 1],
      ["research-products", 2],
      ["ui-exploration", 1],
    ])
  })

  it("hides descendants of collapsed nodes", () => {
    const state = collapseNode(createInitialOutlineState(), "research")
    const rows = getVisibleRows(state)
    expect(rows.map((row) => row.id)).toEqual(["root-project", "research", "ui-exploration"])
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/domain/visibleTree.test.ts
```

Expected: FAIL because `visibleTree.ts` does not exist.

- [ ] **Step 3: Implement visible row flattening**

Create `src/domain/visibleTree.ts`:

```ts
import type { BulletId, OutlineState } from "./types"

export type VisibleRow = {
  id: BulletId
  depth: number
}

export function getVisibleRows(state: OutlineState): VisibleRow[] {
  const rows: VisibleRow[] = []

  function visit(ids: BulletId[], depth: number) {
    for (const id of ids) {
      const node = state.nodes[id]
      if (!node) continue
      rows.push({ id, depth })
      if (!node.collapsed && node.children.length > 0) {
        visit(node.children, depth + 1)
      }
    }
  }

  visit(state.rootIds, 0)
  return rows
}

export function getAdjacentVisibleNodeId(
  state: OutlineState,
  currentId: BulletId,
  direction: "previous" | "next",
): BulletId | null {
  const rows = getVisibleRows(state)
  const index = rows.findIndex((row) => row.id === currentId)
  if (index === -1) return null
  const nextIndex = direction === "previous" ? index - 1 : index + 1
  return rows[nextIndex]?.id ?? null
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/domain/visibleTree.test.ts
npm run lint
```

Expected: visible tree tests and typecheck pass.

- [ ] **Step 5: Commit visible tree helper**

```bash
git add src/domain/visibleTree.ts src/domain/visibleTree.test.ts
git commit -m "feat: add visible outline flattening"
```

---

### Task 5: Add Context Builder And Simulated Runner

**Files:**
- Create: `src/domain/context.ts`
- Create: `src/domain/context.test.ts`
- Create: `src/domain/runner.ts`
- Create: `src/domain/runner.test.ts`

- [ ] **Step 1: Write failing context tests**

Create `src/domain/context.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import { buildRunContext } from "./context"

describe("buildRunContext", () => {
  it("returns ancestor text from root to current node", () => {
    expect(buildRunContext("research-products", createInitialOutlineState())).toBe(
      [
        "Executable Outliner Prototype",
        "Research",
        "Find adjacent products and patterns",
      ].join("\n"),
    )
  })

  it("returns an empty string for an unknown node", () => {
    expect(buildRunContext("missing", createInitialOutlineState())).toBe("")
  })
})
```

- [ ] **Step 2: Write failing runner tests**

Create `src/domain/runner.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createSimulatedOutput } from "./runner"

describe("createSimulatedOutput", () => {
  it("creates deterministic child bullet drafts for a prompt", () => {
    const output = createSimulatedOutput("Project\nResearch\nFind adjacent products")
    expect(output.assistantMessage).toContain("I broke this into a few outline-ready notes")
    expect(output.bullets).toHaveLength(3)
    expect(output.bullets[0].text).toContain("Project")
    expect(output.bullets[0].metadata?.source).toBe("simulated-agent")
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- src/domain/context.test.ts src/domain/runner.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement context builder**

Create `src/domain/context.ts`:

```ts
import type { BulletId, OutlineState } from "./types"

export function buildRunContext(nodeId: BulletId, outline: OutlineState): string {
  const path: string[] = []
  let cursor: BulletId | null = nodeId

  while (cursor) {
    const node = outline.nodes[cursor]
    if (!node) return ""
    path.unshift(node.text)
    cursor = node.parentId
  }

  return path.join("\n")
}
```

- [ ] **Step 5: Implement simulated output generator**

Create `src/domain/runner.ts`:

```ts
import type { BulletDraft } from "./types"

export type SimulatedOutput = {
  assistantMessage: string
  bullets: BulletDraft[]
}

export function createSimulatedOutput(context: string): SimulatedOutput {
  const lines = context
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const focus = lines.at(-1) ?? "this bullet"
  const project = lines[0] ?? "the project"

  return {
    assistantMessage:
      "I broke this into a few outline-ready notes and inserted them as child bullets.",
    bullets: [
      {
        text: `Clarify how "${focus}" supports ${project}.`,
        metadata: { source: "simulated-agent" },
      },
      {
        text: `List the smallest next observation needed for "${focus}".`,
        metadata: { source: "simulated-agent" },
      },
      {
        text: "Keep the generated output short enough to stay useful in the outline.",
        metadata: { source: "simulated-agent" },
      },
    ],
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/domain/context.test.ts src/domain/runner.test.ts
npm run lint
```

Expected: context and runner tests pass.

- [ ] **Step 7: Commit context and runner**

```bash
git add src/domain/context.ts src/domain/context.test.ts src/domain/runner.ts src/domain/runner.test.ts
git commit -m "feat: add simulated run context"
```

---

### Task 6: Add Reducer And Outline Actions

**Files:**
- Create: `src/store/outlineReducer.ts`
- Create: `src/store/outlineReducer.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `src/store/outlineReducer.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "../domain/fixtures"
import { outlineReducer } from "./outlineReducer"

describe("outlineReducer", () => {
  it("focuses a node", () => {
    const next = outlineReducer(createInitialOutlineState(), {
      type: "focus-node",
      nodeId: "ui-exploration",
    })
    expect(next.focusedNodeId).toBe("ui-exploration")
  })

  it("opens and closes the side panel", () => {
    const opened = outlineReducer(createInitialOutlineState(), { type: "open-panel" })
    expect(opened.panelOpen).toBe(true)
    const closed = outlineReducer(opened, { type: "close-panel" })
    expect(closed.panelOpen).toBe(false)
  })

  it("creates a thread and marks the node running", () => {
    const next = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "Executable Outliner Prototype\nResearch\nFind adjacent products and patterns",
      createdAt: 100,
    })
    expect(next.nodes["research-products"].runStatus).toBe("running")
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.selectedThreadId).toBe("thread-1")
    expect(next.panelOpen).toBe(true)
    expect(next.threads["thread-1"].messages[0].role).toBe("user")
  })

  it("applies simulated output and marks run succeeded", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const done = outlineReducer(running, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })
    expect(done.nodes["research-products"].runStatus).toBe("succeeded")
    expect(done.nodes["research-products"].children).toEqual(["generated-1"])
    expect(done.threads["thread-1"].messages.at(-1)?.content).toBe("Done.")
    expect(done.threads["thread-1"].events.some((event) => event.type === "outline-output")).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/store/outlineReducer.test.ts
```

Expected: FAIL because reducer does not exist.

- [ ] **Step 3: Implement reducer**

Create `src/store/outlineReducer.ts`:

```ts
import type { BulletDraft, BulletId, OutlineState, ThreadId } from "../domain/types"
import {
  appendChildBullets,
  collapseNode,
  expandNode,
  indentNode,
  insertSiblingAfter,
  outdentNode,
  reparentNode,
  updateNodeText,
} from "../domain/treeOps"

type DraftWithId = BulletDraft & { id: BulletId }

export type OutlineAction =
  | { type: "focus-node"; nodeId: BulletId }
  | { type: "update-text"; nodeId: BulletId; text: string }
  | { type: "insert-sibling-after"; afterNodeId: BulletId; id: BulletId; text: string }
  | { type: "indent-node"; nodeId: BulletId }
  | { type: "outdent-node"; nodeId: BulletId }
  | { type: "reparent-node"; nodeId: BulletId; targetParentId: BulletId | null }
  | { type: "collapse-node"; nodeId: BulletId }
  | { type: "expand-node"; nodeId: BulletId }
  | { type: "open-panel" }
  | { type: "close-panel" }
  | { type: "select-thread"; threadId: ThreadId | null }
  | {
      type: "run-started"
      nodeId: BulletId
      threadId: ThreadId
      context: string
      createdAt: number
    }
  | {
      type: "run-completed"
      nodeId: BulletId
      threadId: ThreadId
      assistantMessage: string
      bullets: DraftWithId[]
      createdAt: number
    }

export function outlineReducer(state: OutlineState, action: OutlineAction): OutlineState {
  switch (action.type) {
    case "focus-node":
      return { ...state, focusedNodeId: action.nodeId }
    case "update-text":
      return updateNodeText(state, action.nodeId, action.text)
    case "insert-sibling-after":
      return insertSiblingAfter(state, action.afterNodeId, { id: action.id, text: action.text })
    case "indent-node":
      return indentNode(state, action.nodeId)
    case "outdent-node":
      return outdentNode(state, action.nodeId)
    case "reparent-node":
      return reparentNode(state, action.nodeId, action.targetParentId)
    case "collapse-node":
      return collapseNode(state, action.nodeId)
    case "expand-node":
      return expandNode(state, action.nodeId)
    case "open-panel":
      return { ...state, panelOpen: true }
    case "close-panel":
      return { ...state, panelOpen: false }
    case "select-thread":
      return { ...state, selectedThreadId: action.threadId, panelOpen: action.threadId ? true : state.panelOpen }
    case "run-started": {
      const existingThread = state.threads[action.threadId]
      if (existingThread) {
        return {
          ...state,
          focusedNodeId: action.nodeId,
          selectedThreadId: action.threadId,
          panelOpen: true,
        }
      }
      return {
        ...state,
        focusedNodeId: action.nodeId,
        selectedThreadId: action.threadId,
        panelOpen: true,
        nodes: {
          ...state.nodes,
          [action.nodeId]: {
            ...state.nodes[action.nodeId],
            runStatus: "running",
            threadId: action.threadId,
          },
        },
        threads: {
          ...state.threads,
          [action.threadId]: {
            id: action.threadId,
            nodeId: action.nodeId,
            messages: [
              {
                id: `${action.threadId}-user`,
                role: "user",
                content: action.context,
                createdAt: action.createdAt,
                status: "complete",
              },
            ],
            events: [{ type: "run-started", nodeId: action.nodeId, createdAt: action.createdAt }],
          },
        },
      }
    }
    case "run-completed": {
      const withChildren = appendChildBullets(state, action.nodeId, action.bullets)
      const thread = withChildren.threads[action.threadId]
      if (!thread) return withChildren
      return {
        ...withChildren,
        nodes: {
          ...withChildren.nodes,
          [action.nodeId]: {
            ...withChildren.nodes[action.nodeId],
            runStatus: "succeeded",
          },
        },
        threads: {
          ...withChildren.threads,
          [action.threadId]: {
            ...thread,
            messages: [
              ...thread.messages,
              {
                id: `${action.threadId}-assistant-${action.createdAt}`,
                role: "assistant",
                content: action.assistantMessage,
                createdAt: action.createdAt,
                status: "complete",
              },
            ],
            events: [
              ...thread.events,
              {
                type: "outline-output",
                output: { type: "append-child-bullets", parentId: action.nodeId, bullets: action.bullets },
                createdAt: action.createdAt,
              },
              { type: "run-completed", nodeId: action.nodeId, createdAt: action.createdAt },
            ],
          },
        },
      }
    }
    default:
      return state
  }
}
```

- [ ] **Step 4: Run reducer tests**

Run:

```bash
npm test -- src/store/outlineReducer.test.ts
npm run lint
```

Expected: reducer tests and typecheck pass.

- [ ] **Step 5: Commit reducer**

```bash
git add src/store/outlineReducer.ts src/store/outlineReducer.test.ts
git commit -m "feat: add outline reducer"
```

---

### Task 7: Add React Store And Async Run Orchestration

**Files:**
- Create: `src/store/OutlineStore.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create store provider**

Create `src/store/OutlineStore.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useReducer } from "react"
import type { Dispatch, ReactNode } from "react"
import { buildRunContext } from "../domain/context"
import { createInitialOutlineState } from "../domain/fixtures"
import { createSimulatedOutput } from "../domain/runner"
import type { BulletId, OutlineState } from "../domain/types"
import { outlineReducer, type OutlineAction } from "./outlineReducer"

type OutlineStoreValue = {
  state: OutlineState
  dispatch: Dispatch<OutlineAction>
  executeNode: (nodeId: BulletId) => void
}

const OutlineStoreContext = createContext<OutlineStoreValue | null>(null)

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function OutlineStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(outlineReducer, undefined, createInitialOutlineState)

  const executeNode = useCallback(
    (nodeId: BulletId) => {
      const node = state.nodes[nodeId]
      if (!node) return

      if (node.threadId) {
        dispatch({ type: "select-thread", threadId: node.threadId })
        dispatch({ type: "open-panel" })
        return
      }

      const threadId = nextId("thread")
      const context = buildRunContext(nodeId, state)
      const startedAt = Date.now()
      dispatch({ type: "run-started", nodeId, threadId, context, createdAt: startedAt })

      window.setTimeout(() => {
        const output = createSimulatedOutput(context)
        dispatch({
          type: "run-completed",
          nodeId,
          threadId,
          assistantMessage: output.assistantMessage,
          bullets: output.bullets.map((bullet) => ({
            ...bullet,
            id: nextId("generated"),
          })),
          createdAt: Date.now(),
        })
      }, 1000)
    },
    [state],
  )

  const value = useMemo(() => ({ state, dispatch, executeNode }), [state, executeNode])

  return <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>
}

export function useOutlineStore(): OutlineStoreValue {
  const value = useContext(OutlineStoreContext)
  if (!value) {
    throw new Error("useOutlineStore must be used inside OutlineStoreProvider")
  }
  return value
}
```

- [ ] **Step 2: Wrap the app with provider**

Modify `src/App.tsx`:

```tsx
import { OutlineStoreProvider } from "./store/OutlineStore"

export function App() {
  return (
    <OutlineStoreProvider>
      <main className="app-shell">
        <section className="outline-pane">
          <p className="empty-state">Executable Outliner V1</p>
        </section>
      </main>
    </OutlineStoreProvider>
  )
}
```

- [ ] **Step 3: Verify store compiles**

Run:

```bash
npm run lint
```

Expected: TypeScript passes.

- [ ] **Step 4: Commit store**

```bash
git add src/store/OutlineStore.tsx src/App.tsx
git commit -m "feat: add outline store provider"
```

---

### Task 8: Render Outline Rows And Editing

**Files:**
- Create: `src/components/OutlineView.tsx`
- Create: `src/components/BulletRow.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Create outline rendering components**

Create `src/components/OutlineView.tsx`:

```tsx
import { getVisibleRows } from "../domain/visibleTree"
import { useOutlineStore } from "../store/OutlineStore"
import { BulletRow } from "./BulletRow"

export function OutlineView() {
  const { state } = useOutlineStore()
  const rows = getVisibleRows(state)

  return (
    <div className="outline" aria-label="Executable outline">
      {rows.map((row) => (
        <BulletRow key={row.id} nodeId={row.id} depth={row.depth} />
      ))}
    </div>
  )
}
```

Create `src/components/BulletRow.tsx`:

```tsx
import { ChevronRight, Loader2, MessageSquare, Play } from "lucide-react"
import type { CSSProperties, KeyboardEvent } from "react"
import { getAdjacentVisibleNodeId } from "../domain/visibleTree"
import type { BulletId } from "../domain/types"
import { useOutlineStore } from "../store/OutlineStore"

type BulletRowProps = {
  nodeId: BulletId
  depth: number
}

export function BulletRow({ nodeId, depth }: BulletRowProps) {
  const { state, dispatch, executeNode } = useOutlineStore()
  const node = state.nodes[nodeId]
  const focused = state.focusedNodeId === nodeId
  const hasChildren = node.children.length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey && event.key === "Enter") {
      event.preventDefault()
      executeNode(nodeId)
      return
    }
    if (event.metaKey && event.key === "ArrowDown") {
      event.preventDefault()
      dispatch({ type: "expand-node", nodeId })
      return
    }
    if (event.metaKey && event.key === "ArrowUp") {
      event.preventDefault()
      dispatch({ type: "collapse-node", nodeId })
      return
    }
    if (event.metaKey && event.key === "ArrowRight") {
      event.preventDefault()
      if (node.threadId) dispatch({ type: "select-thread", threadId: node.threadId })
      dispatch({ type: "open-panel" })
      return
    }
    if (event.metaKey && event.key === "ArrowLeft") {
      event.preventDefault()
      dispatch({ type: "close-panel" })
      return
    }
    if (event.key === "Tab") {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? "outdent-node" : "indent-node", nodeId })
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      dispatch({
        type: "insert-sibling-after",
        afterNodeId: nodeId,
        id: `node-${Date.now()}`,
        text: "",
      })
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const adjacent = getAdjacentVisibleNodeId(
        state,
        nodeId,
        event.key === "ArrowUp" ? "previous" : "next",
      )
      if (adjacent) {
        event.preventDefault()
        dispatch({ type: "focus-node", nodeId: adjacent })
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(`[data-node-input="${adjacent}"]`)?.focus()
        })
      }
    }
  }

  return (
    <div
      className={`bullet-row ${focused ? "is-focused" : ""}`}
      style={{ "--depth": depth } as CSSProperties}
      data-node-id={nodeId}
      onMouseDown={() => dispatch({ type: "focus-node", nodeId })}
    >
      <button
        className={`bullet-marker ${hasChildren ? "has-children" : ""}`}
        type="button"
        aria-label={node.collapsed ? "Expand bullet" : "Collapse bullet"}
        onClick={() =>
          dispatch({ type: node.collapsed ? "expand-node" : "collapse-node", nodeId })
        }
      >
        {hasChildren ? <ChevronRight className={node.collapsed ? "" : "expanded"} size={16} /> : "•"}
      </button>
      <input
        className="bullet-input"
        data-node-input={nodeId}
        value={node.text}
        onFocus={() => dispatch({ type: "focus-node", nodeId })}
        onChange={(event) =>
          dispatch({ type: "update-text", nodeId, text: event.currentTarget.value })
        }
        onKeyDown={handleKeyDown}
      />
      <div className="row-controls">
        {node.runStatus === "running" ? (
          <Loader2 className="spin" size={16} aria-label="Running" />
        ) : node.threadId ? (
          <button
            className="icon-button"
            type="button"
            aria-label="Open bullet chat"
            onClick={() => {
              dispatch({ type: "select-thread", threadId: node.threadId! })
              dispatch({ type: "open-panel" })
            }}
          >
            <MessageSquare size={15} />
          </button>
        ) : (
          <button
            className="icon-button"
            type="button"
            aria-label="Execute bullet"
            onClick={() => executeNode(nodeId)}
          >
            <Play size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render the outline in App**

Modify `src/App.tsx`:

```tsx
import { OutlineView } from "./components/OutlineView"
import { OutlineStoreProvider } from "./store/OutlineStore"

export function App() {
  return (
    <OutlineStoreProvider>
      <main className="app-shell">
        <section className="outline-pane">
          <OutlineView />
        </section>
      </main>
    </OutlineStoreProvider>
  )
}
```

- [ ] **Step 3: Add outline styles**

Append to `src/styles.css`:

```css
.outline {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bullet-row {
  --indent-size: 28px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 76px;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 2px 8px 2px calc(8px + (var(--depth) * var(--indent-size)));
  border: 1px solid transparent;
  border-radius: 6px;
}

.bullet-row:hover,
.bullet-row.is-focused {
  background: #fff;
  border-color: #dce2ea;
  box-shadow: 0 1px 2px rgb(24 31 41 / 0.04);
}

.bullet-marker,
.icon-button {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: #687080;
  border-radius: 5px;
  cursor: pointer;
}

.bullet-marker:hover,
.icon-button:hover {
  background: #eef1f5;
  color: #20242a;
}

.bullet-marker svg {
  transition: transform 120ms ease;
}

.bullet-marker svg.expanded {
  transform: rotate(90deg);
}

.bullet-input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #20242a;
  font-size: 15px;
  line-height: 1.4;
}

.row-controls {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  opacity: 0;
}

.bullet-row:hover .row-controls,
.bullet-row.is-focused .row-controls,
.row-controls:has(.spin) {
  opacity: 1;
}

.spin {
  animation: spin 0.8s linear infinite;
  color: #4d6bfe;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 4: Verify outline UI compiles**

Run:

```bash
npm run lint
npm run build
```

Expected: TypeScript and production build pass.

- [ ] **Step 5: Commit outline UI**

```bash
git add src/App.tsx src/components/OutlineView.tsx src/components/BulletRow.tsx src/styles.css
git commit -m "feat: render editable outline"
```

---

### Task 9: Add Side Panel And Chat Thread UI

**Files:**
- Create: `src/components/SidePanel.tsx`
- Create: `src/components/ChatThreadView.tsx`
- Create: `src/components/ChatInput.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Create chat timeline components**

Create `src/components/ChatThreadView.tsx`:

```tsx
import type { AgentEvent, AgentMessage } from "../domain/types"

type ChatThreadViewProps = {
  messages: AgentMessage[]
  events: AgentEvent[]
}

export function ChatThreadView({ messages, events }: ChatThreadViewProps) {
  return (
    <div className="chat-timeline">
      {messages.map((message) => (
        <article key={message.id} className={`chat-message ${message.role}`}>
          <div className="chat-role">{message.role}</div>
          <p>{message.content}</p>
        </article>
      ))}
      {events
        .filter((event) => event.type === "outline-output")
        .map((event, index) => (
          <article key={`${event.createdAt}-${index}`} className="event-card">
            <strong>Outline output</strong>
            {"output" in event && event.output.type === "append-child-bullets" ? (
              <p>Appended {event.output.bullets.length} child bullets.</p>
            ) : (
              <p>Updated outline state.</p>
            )}
          </article>
        ))}
    </div>
  )
}
```

Create `src/components/ChatInput.tsx`:

```tsx
export function ChatInput() {
  return (
    <form className="chat-input" onSubmit={(event) => event.preventDefault()}>
      <textarea aria-label="Chat input" placeholder="Ask a follow-up..." rows={2} />
      <button type="submit">Send</button>
    </form>
  )
}
```

- [ ] **Step 2: Create side panel**

Create `src/components/SidePanel.tsx`:

```tsx
import { X } from "lucide-react"
import { useOutlineStore } from "../store/OutlineStore"
import { ChatInput } from "./ChatInput"
import { ChatThreadView } from "./ChatThreadView"

export function SidePanel() {
  const { state, dispatch } = useOutlineStore()
  const thread = state.selectedThreadId ? state.threads[state.selectedThreadId] : null
  const node = thread ? state.nodes[thread.nodeId] : state.focusedNodeId ? state.nodes[state.focusedNodeId] : null

  if (!state.panelOpen) return null

  return (
    <aside className="side-panel" aria-label="Bullet chat panel">
      <header className="side-panel-header">
        <div>
          <span className="panel-eyebrow">Bullet Chat</span>
          <h2>{node?.text || "No bullet selected"}</h2>
          <p>{node ? node.runStatus : "idle"}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close panel"
          onClick={() => dispatch({ type: "close-panel" })}
        >
          <X size={16} />
        </button>
      </header>
      {thread ? (
        <ChatThreadView messages={thread.messages} events={thread.events} />
      ) : (
        <div className="panel-empty">Execute this bullet to create its chat thread.</div>
      )}
      <ChatInput />
    </aside>
  )
}
```

- [ ] **Step 3: Render panel in App**

Modify `src/App.tsx`:

```tsx
import { OutlineView } from "./components/OutlineView"
import { SidePanel } from "./components/SidePanel"
import { OutlineStoreProvider } from "./store/OutlineStore"

export function App() {
  return (
    <OutlineStoreProvider>
      <main className="app-shell">
        <section className="outline-pane">
          <OutlineView />
        </section>
        <SidePanel />
      </main>
    </OutlineStoreProvider>
  )
}
```

- [ ] **Step 4: Add side panel styles**

Append to `src/styles.css`:

```css
.app-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}

.side-panel {
  width: min(420px, 40vw);
  min-width: 340px;
  height: 100vh;
  position: sticky;
  top: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border-left: 1px solid #dde3eb;
  background: #fbfcfe;
}

.side-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  border-bottom: 1px solid #e3e8ef;
  background: #fff;
}

.panel-eyebrow,
.chat-role {
  color: #687080;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.side-panel-header h2 {
  margin: 4px 0;
  font-size: 16px;
  line-height: 1.35;
}

.side-panel-header p {
  margin: 0;
  color: #687080;
  font-size: 13px;
}

.chat-timeline {
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-message,
.event-card,
.panel-empty {
  border: 1px solid #dfe5ee;
  border-radius: 8px;
  padding: 11px 12px;
  background: #fff;
  font-size: 13px;
  line-height: 1.45;
}

.chat-message.user {
  align-self: flex-end;
  max-width: 88%;
  background: #20242a;
  color: #fff;
}

.chat-message.assistant {
  align-self: flex-start;
  max-width: 92%;
}

.chat-message p,
.event-card p {
  margin: 5px 0 0;
  white-space: pre-wrap;
}

.event-card {
  background: #eef4ff;
  border-color: #c8d9ff;
  color: #33415c;
}

.panel-empty {
  margin: 16px;
  color: #687080;
}

.chat-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid #e3e8ef;
  background: #fff;
}

.chat-input textarea {
  resize: none;
  border: 1px solid #d5dce5;
  border-radius: 8px;
  padding: 9px 10px;
  outline: 0;
}

.chat-input button {
  border: 0;
  border-radius: 7px;
  background: #20242a;
  color: #fff;
  padding: 0 14px;
}
```

- [ ] **Step 5: Verify side panel**

Run:

```bash
npm run lint
npm run build
```

Expected: build passes.

- [ ] **Step 6: Commit side panel**

```bash
git add src/components/SidePanel.tsx src/components/ChatThreadView.tsx src/components/ChatInput.tsx src/App.tsx src/styles.css
git commit -m "feat: add bullet chat side panel"
```

---

### Task 10: Add Keyboard Focus Polish And Chat Input Focus

**Files:**
- Modify: `src/components/ChatInput.tsx`
- Modify: `src/components/SidePanel.tsx`
- Modify: `src/components/BulletRow.tsx`

- [ ] **Step 1: Update ChatInput to accept autofocus trigger**

Modify `src/components/ChatInput.tsx`:

```tsx
import { useEffect, useRef } from "react"

type ChatInputProps = {
  autoFocusKey: string | null
}

export function ChatInput({ autoFocusKey }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (autoFocusKey) inputRef.current?.focus()
  }, [autoFocusKey])

  return (
    <form className="chat-input" onSubmit={(event) => event.preventDefault()}>
      <textarea ref={inputRef} aria-label="Chat input" placeholder="Ask a follow-up..." rows={2} />
      <button type="submit">Send</button>
    </form>
  )
}
```

- [ ] **Step 2: Pass thread id to ChatInput**

Modify the bottom of `src/components/SidePanel.tsx`:

```tsx
      <ChatInput autoFocusKey={state.selectedThreadId} />
```

- [ ] **Step 3: Make Cmd+Right open panel for current bullet**

In `src/components/BulletRow.tsx`, keep the existing `Cmd+ArrowRight` branch and verify it opens an empty ready panel even when the bullet has no thread:

```tsx
    if (event.metaKey && event.key === "ArrowRight") {
      event.preventDefault()
      if (node.threadId) dispatch({ type: "select-thread", threadId: node.threadId })
      dispatch({ type: "open-panel" })
      return
    }
```

- [ ] **Step 4: Verify keyboard behavior manually**

Run:

```bash
npm run dev
```

Open the local URL. Manually verify:

- Focus a bullet and press `Cmd+Right`: side panel opens.
- Press `Cmd+Left`: side panel closes.
- Press `Cmd+Enter`: side panel opens and chat input focuses after thread creation.
- Press `Cmd+Up`: focused bullet collapses.
- Press `Cmd+Down`: focused bullet expands.

- [ ] **Step 5: Commit focus polish**

```bash
git add src/components/ChatInput.tsx src/components/SidePanel.tsx src/components/BulletRow.tsx
git commit -m "feat: polish panel keyboard focus"
```

---

### Task 11: Add Drag-To-Reparent

**Files:**
- Create: `src/components/DragLayer.tsx`
- Modify: `src/components/OutlineView.tsx`
- Modify: `src/components/BulletRow.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Create drag wrapper**

Create `src/components/DragLayer.tsx`:

```tsx
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import type { ReactNode } from "react"
import { useOutlineStore } from "../store/OutlineStore"

type DragLayerProps = {
  children: ReactNode
}

export function DragLayer({ children }: DragLayerProps) {
  const { dispatch } = useOutlineStore()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId) return
    dispatch({ type: "reparent-node", nodeId: activeId, targetParentId: overId })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  )
}
```

- [ ] **Step 2: Wrap outline in DragLayer**

Modify `src/components/OutlineView.tsx`:

```tsx
import { getVisibleRows } from "../domain/visibleTree"
import { useOutlineStore } from "../store/OutlineStore"
import { BulletRow } from "./BulletRow"
import { DragLayer } from "./DragLayer"

export function OutlineView() {
  const { state } = useOutlineStore()
  const rows = getVisibleRows(state)

  return (
    <DragLayer>
      <div className="outline" aria-label="Executable outline">
        {rows.map((row) => (
          <BulletRow key={row.id} nodeId={row.id} depth={row.depth} />
        ))}
      </div>
    </DragLayer>
  )
}
```

- [ ] **Step 3: Make rows draggable/droppable**

Modify `src/components/BulletRow.tsx` imports:

```tsx
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
```

Inside `BulletRow`, after `const hasChildren = ...`, add:

```tsx
  const draggable = useDraggable({ id: nodeId })
  const droppable = useDroppable({ id: nodeId })
  const transform = CSS.Translate.toString(draggable.transform)
```

Update the row wrapper:

```tsx
    <div
      ref={(element) => {
        draggable.setNodeRef(element)
        droppable.setNodeRef(element)
      }}
      className={`bullet-row ${focused ? "is-focused" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
      style={{ "--depth": depth, transform } as CSSProperties}
      data-node-id={nodeId}
      onMouseDown={() => dispatch({ type: "focus-node", nodeId })}
    >
```

Add drag attributes to the marker button:

```tsx
        {...draggable.listeners}
        {...draggable.attributes}
```

- [ ] **Step 4: Add drop target styles**

Append to `src/styles.css`:

```css
.bullet-row.is-drop-target {
  border-color: #4d6bfe;
  background: #eef4ff;
}
```

- [ ] **Step 5: Verify drag behavior**

Run:

```bash
npm run lint
npm run build
```

Expected: build passes. Manual check: drag one bullet onto another; dragged bullet becomes the last child of the target and target expands.

- [ ] **Step 6: Commit drag-to-reparent**

```bash
git add src/components/DragLayer.tsx src/components/OutlineView.tsx src/components/BulletRow.tsx src/styles.css
git commit -m "feat: add drag to reparent bullets"
```

---

### Task 12: Add Generated Output Styling And Status Copy

**Files:**
- Modify: `src/components/BulletRow.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Mark generated rows**

In `src/components/BulletRow.tsx`, derive generated state:

```tsx
  const generated = node.metadata.generated === true
```

Update class name:

```tsx
      className={`bullet-row ${focused ? "is-focused" : ""} ${generated ? "is-generated" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
```

Inside `row-controls`, render generated status text when no active control is being shown:

```tsx
        {node.runStatus === "running" ? (
          <Loader2 className="spin" size={16} aria-label="Running" />
        ) : node.threadId ? (
          <button
            className="icon-button"
            type="button"
            aria-label="Open bullet chat"
            onClick={() => {
              dispatch({ type: "select-thread", threadId: node.threadId! })
              dispatch({ type: "open-panel" })
            }}
          >
            <MessageSquare size={15} />
          </button>
        ) : generated ? (
          <span className="row-badge">generated</span>
        ) : (
          <button
            className="icon-button"
            type="button"
            aria-label="Execute bullet"
            onClick={() => executeNode(nodeId)}
          >
            <Play size={15} />
          </button>
        )}
```

- [ ] **Step 2: Style generated rows**

Append to `src/styles.css`:

```css
.bullet-row.is-generated .bullet-input {
  color: #343942;
}

.row-badge {
  align-self: center;
  color: #7a8290;
  font-size: 11px;
}
```

- [ ] **Step 3: Verify generated rows manually**

Run:

```bash
npm run dev
```

Manual check:

- Execute a bullet.
- Wait one second.
- Confirm generated child bullets appear.
- Confirm generated child bullets remain editable and movable.
- Confirm generated rows have subtle generated labeling.

- [ ] **Step 4: Commit output styling**

```bash
git add src/components/BulletRow.tsx src/styles.css
git commit -m "feat: style generated outline output"
```

---

### Task 13: Final Verification And Browser QA

**Files:**
- Modify only if verification reveals defects.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass, TypeScript passes, production build succeeds.

- [ ] **Step 2: Start dev server**

Run:

```bash
npm run dev
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 3: Browser smoke test**

Using the in-app browser, verify:

- Initial outline renders.
- Row controls appear on hover/focus.
- `Enter` creates a sibling.
- `Tab` indents.
- `Shift+Tab` outdents.
- `Cmd+Enter` starts a simulated run.
- Running bullet shows spinner.
- Side panel opens with chat.
- After one second, assistant message appears.
- Outline output event appears.
- Generated child bullets appear under the executed bullet.
- `Cmd+Up` collapses the focused bullet.
- `Cmd+Down` expands it.
- `Cmd+Right` opens the side panel.
- `Cmd+Left` closes the side panel.
- Dragging one bullet onto another reparents it.

- [ ] **Step 4: Capture screenshots**

Capture screenshots for:

- Initial outline.
- Running state with side panel.
- Completed run with generated child bullets.
- Collapsed generated branch.

- [ ] **Step 5: Fix any defects found**

For each defect, add the smallest targeted test if it is domain/reducer behavior. Then patch the implementation and rerun:

```bash
npm test
npm run lint
npm run build
```

Expected: checks pass after each fix.

- [ ] **Step 6: Final commit**

```bash
git status --short
git add .
git commit -m "feat: build executable outliner prototype"
```

---

## Self-Review Notes

- Spec coverage: the plan covers the normalized bullet model, no task state, no real agent backend, simple context builder, simulated execution, side panel chat, structured outline outputs, keyboard collapse/expand, keyboard execution, quiet row controls, generated output styling, and drag-to-reparent.
- Deferred by design: real LLMs, files, tool calls, collaboration, rich text, Workflowy zoom, rerun semantics, and production persistence.
- Type consistency: `BulletId`, `ThreadId`, `BulletRunStatus`, `OutlineState`, `AgentThread`, `AgentMessage`, `AgentEvent`, `OutlineOutput`, and `BulletDraft` use the same names throughout the plan.
- Risk to watch during implementation: dnd-kit nested reparenting can become complex. V1 intentionally uses “drop onto row to become last child” instead of full between-row placement.
