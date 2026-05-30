# Executable Outliner V1 Design

## Summary

Build a prototype of a Workflowy-like nested outline where any bullet can become the entry point for an agent conversation. The outline remains the primary work surface: fast, keyboard-first, quiet, and rearrangeable. The side panel exposes the full simulated agent chat for the selected executed bullet.

V1 uses simulated agents only. The goal is to validate the interaction model, data model, keyboard flow, collapse behavior, and outline-to-chat relationship before connecting a real agent harness.

## Product Thesis

The document is not a dashboard for work. The document is where work happens.

Each bullet is both a visible line in an outline and a rich object that can hold hidden state. Most bullets remain plain thought. Some bullets become executable prompts. Executed bullets keep a chat thread, status, generated outputs, and future extension data, while still behaving like normal movable outline nodes.

## V1 Goals

- Provide a keyboard-first nested outliner with Workflowy-like editing.
- Model bullets as rich objects, not plain text rows.
- Support moving bullets up/down, indenting/outdenting, collapsing/expanding, and drag-to-reparent.
- Execute a bullet with `Cmd+Enter`.
- Simulate an agent run for the executed bullet.
- Open a side panel that shows the bullet's agent chat thread.
- Append simulated agent output as child bullets.
- Keep the main outline visually quiet, with controls appearing on hover/focus.
- Leave natural extension points for future task state, tool calls, files, artifacts, real streaming, and richer chat harnesses.

## V1 Non-Goals

- No real LLM or agent backend.
- No checkbox or task completion state.
- No rich text editing.
- No Workflowy-style zoom into a bullet.
- No real file handling.
- No real tool execution.
- No collaboration or auth.
- No production persistence requirements beyond local prototype storage.

## Core Surfaces

### Outline

The outline is the primary surface. It should feel like a document, not a task dashboard. Rows render as nested bullets with editable text. Controls are hidden by default and appear on hover or focus.

Each row may show:

- A stable bullet/disclosure marker.
- Editable text.
- A row-end play button or chat affordance on hover/focus.
- A running/succeeded/failed status indicator when relevant.
- Generated child bullets below it.

### Side Panel

The side panel shows the full simulated agent thread for one bullet. It is not a replacement for the outline. It is the inspectable conversation behind a bullet.

The panel contains:

- Header with selected bullet text and run status.
- Message timeline.
- Event/tool-style cards for outline mutations.
- Chat input at the bottom.

For V1, the chat input can be local and simulated. It should still look and feel like a normal agentic chat interface so future tool calls, files, and streaming fit naturally.

## Data Model

Use a normalized tree so structural operations are simple and testable.

```ts
type BulletId = string
type ThreadId = string

type BulletRunStatus = "idle" | "running" | "succeeded" | "failed"

type OutlineState = {
  rootIds: BulletId[]
  nodes: Record<BulletId, BulletNode>
  focusedNodeId: BulletId | null
  selectedThreadId: ThreadId | null
  panelOpen: boolean
}

type BulletNode = {
  id: BulletId
  parentId: BulletId | null
  children: BulletId[]
  text: string
  collapsed: boolean
  runStatus: BulletRunStatus
  threadId?: ThreadId
  metadata: Record<string, unknown>
}
```

Avoid task-specific fields in V1. Later task behavior can be added through metadata, traits, or row components without changing the core tree model.

## Chat And Event Model

Each executed bullet can have one local thread.

```ts
type AgentThread = {
  id: ThreadId
  nodeId: BulletId
  messages: AgentMessage[]
  events: AgentEvent[]
}

type AgentMessage = {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt: number
  status?: "streaming" | "complete" | "error"
}

type AgentEvent =
  | { type: "run-started"; nodeId: BulletId; createdAt: number }
  | { type: "message-created"; messageId: string; createdAt: number }
  | { type: "outline-output"; output: OutlineOutput; createdAt: number }
  | { type: "run-completed"; nodeId: BulletId; createdAt: number }

type OutlineOutput =
  | { type: "append-child-bullets"; parentId: BulletId; bullets: BulletDraft[] }
  | { type: "update-node-status"; nodeId: BulletId; status: BulletRunStatus }

type BulletDraft = {
  text: string
  metadata?: Record<string, unknown>
}
```

Assistant text does not mutate the outline directly. Only structured `OutlineOutput` events mutate outline state. This keeps the durable outline curated and inspectable.

## Context Building

Do not introduce a configurable context policy in V1.

Use one simple function boundary:

```ts
function buildRunContext(nodeId: BulletId, outline: OutlineState): string
```

For V1, the function returns the current bullet plus its ancestor chain, ordered root-to-leaf.

Example:

```text
Project: Executable Outliner
Research
Find adjacent products
```

This boundary leaves room for future context retrieval, linked nodes, sibling inclusion, semantic search, and agent tools without adding premature config structures.

## Execution Flow

When the user executes a bullet with no existing thread:

1. Read focused node id.
2. Build run context from ancestors plus current bullet.
3. Create a thread for the bullet.
4. Open the side panel.
5. Focus the chat input.
6. Add a user message containing the context/prompt.
7. Set bullet `runStatus` to `running`.
8. Add simulated assistant output after a short delay.
9. Emit an `append-child-bullets` outline output event.
10. Insert generated bullets as children of the executed bullet.
11. Set bullet `runStatus` to `succeeded`.

If the bullet already has a thread:

- `Cmd+Enter` opens the side panel and focuses the chat input.
- If the bullet is running, the panel opens for observation.
- V1 does not define re-run semantics.

## Keyboard Contract

- `Enter`: create sibling below.
- `Tab`: indent under previous sibling.
- `Shift+Tab`: outdent to parent level.
- `Cmd+Enter`: execute focused bullet, or open existing thread and focus chat input.
- `Cmd+Right`: open/focus side panel for current bullet.
- `Cmd+Left`: close side panel and return focus to outline.
- `Cmd+Down`: expand focused bullet.
- `Cmd+Up`: collapse focused bullet.
- `ArrowUp` / `ArrowDown`: navigate visible bullets.
- `Cmd+ArrowUp` / `Cmd+ArrowDown` for moving bullets is deferred until shortcut conflicts feel clear.

Workflowy uses `Cmd+Enter` for complete, but V1 has no completion state, so `Cmd+Enter` is reserved for execution.

## Structural Operations

Implement outline changes through pure tree operations:

- Insert sibling.
- Insert child.
- Delete empty bullet.
- Indent.
- Outdent.
- Move up among visible/sibling nodes.
- Move down among visible/sibling nodes.
- Reparent via drag/drop.
- Collapse node.
- Expand node.

Each operation must preserve subtree integrity. Moving a bullet always moves its descendants.

## Component Architecture

Suggested components and modules:

- `OutlineStore`: owns outline state, threads, focus, selected node, and panel open state.
- `treeOps`: pure functions for structural mutations.
- `context`: `buildRunContext`.
- `runner`: simulated async execution and output generation.
- `OutlineView`: renders visible tree.
- `BulletRow`: renders editable row, marker, text, status, and hover/focus controls.
- `SidePanel`: renders selected bullet thread.
- `ChatThreadView`: renders messages and event cards.
- `ChatInput`: local input for simulated follow-ups.

The row renderer should have room for future slots, but V1 does not need a formal slot system. Keep the visual component API flexible without introducing unused abstractions.

## Prototype Stack

Recommended stack:

- React + Vite.
- TypeScript.
- dnd-kit for drag/drop and reparenting.
- Local browser storage for persistence if needed.
- Custom local chat UI for V1 simulation.

Future-compatible options:

- Vercel AI SDK `useChat` for real streaming chat behavior.
- assistant-ui for a more complete React chat UI.
- AG-UI or CopilotKit if richer frontend-agent event protocol needs emerge.

Do not start with Pi or Hermes as the embedded UI. They may be useful references or future backend experiments, but they are not the right V1 frontend harness.

## Visual And Interaction Principles

- The outline should feel like a document, not an admin app.
- Most controls should appear only on hover/focus.
- The bullet marker remains the structural anchor.
- Execution controls live at row end.
- Running state should be visible but quiet.
- Generated bullets should look like normal outline children with subtle generated metadata.
- The side panel can be more explicit because it is an inspection surface.

## Open Questions For Later

- Should existing-thread bullets support re-run, fork, or continue-only semantics?
- How should generated bullets distinguish agent output from user-authored text?
- Should side panel visibility follow selection automatically in some modes?
- What is the right model for files and artifacts?
- How should real tool calls be represented in the thread and outline?
- Should collapse state be per-user/view state or stored on the bullet object?
- What persistence layer is appropriate after the local prototype?
- Should future Workflowy-style zoom coexist with side-panel chat, or stay out?

## Success Criteria

The prototype succeeds if a user can:

1. Rapidly write and restructure nested bullets with the keyboard.
2. Execute a bullet with `Cmd+Enter`.
3. See that bullet become a running process without losing outline feel.
4. Watch or inspect the simulated chat in the side panel.
5. See structured output appear as child bullets.
6. Collapse generated branches to keep the outline manageable.
7. Move executed bullets and generated children like normal outline content.

