# Actionpad Codex Runtime Design

## Summary

Rename the prototype product to Actionpad and add a local agent runtime that lets executable bullets run real Codex agent sessions. The web app remains the primary surface: a notepad-like outline where bullets are edited, executed, observed, rearranged, and used as the durable record of work. The runtime is a separate local Node process that owns agent execution and streams normalized events back to the app.

This phase should make the simulated agent boundary real without turning the UI into a generic chat client. A bullet remains the unit of intent. Its side panel becomes the full agent transcript. Its child bullets remain the curated output that belongs in the outline.

## Product Name

The app name is Actionpad.

Rename visible and package-level references from "Executable Outliner" to "Actionpad":

- Browser title: `Actionpad`
- Seed root bullet: `Actionpad Prototype`
- Package name: `actionpad`
- New docs and runtime modules should use Actionpad terminology.
- Existing historical V1 docs may keep their old titles because they describe the earlier prototype phase.

The repository folder does not need to be renamed in this phase.

## Product Thesis

Actionpad is an action-oriented notepad. The outline is not a dashboard beside the work; it is the work surface.

Each bullet can remain plain text, or it can become an executable prompt. Executing a bullet starts or resumes an agent conversation linked to that bullet. The full transcript, tool events, approvals, and errors live behind the bullet in the side panel. The outline receives only selected structured outputs, usually child bullets.

## Phase 2 Goals

- Add a local runtime process beside the web app.
- Integrate Codex first through a provider interface that can later support Claude Code, shell runners, remote workers, or other agent harnesses.
- Replace simulated runs with runtime-driven runs while preserving the current outline and side-panel interaction model.
- Keep `Cmd+Enter` as the execution/open-thread shortcut.
- Stream normalized runtime events to the web app.
- Store thread/run metadata on bullets and in the app state.
- Apply agent outputs to the outline only through structured patches.
- Preserve the current keyboard-first notepad feel.
- Keep the implementation local-first and prototype-friendly.

## Phase 2 Non-Goals

- No hosted backend.
- No collaboration or multi-user sync.
- No account system inside Actionpad.
- No desktop shell packaging yet.
- No MCP server implementation yet.
- No arbitrary agent write access to the outline.
- No full approval workflow beyond representing approval requests as events if the provider emits them.
- No provider other than Codex in the first implementation.
- No durable database. Runtime state can remain in memory for the first implementation.

## Architecture

Use a two-process architecture.

```text
Actionpad Web App
  - React outline editor
  - keyboard interactions
  - side-panel transcript UI
  - outline state and undo
  - applies structured outline patches

Actionpad Runtime
  - local Node/TypeScript service
  - HTTP command API
  - WebSocket event stream
  - provider registry
  - Codex provider
  - run/session lifecycle

Codex Provider
  - wraps Codex SDK or app-server integration
  - starts/resumes Codex threads
  - maps Codex events into Actionpad events
```

The web app never imports the Codex SDK directly. It talks only to the Actionpad runtime protocol. This keeps the UI independent from provider-specific auth, process management, event formats, and future desktop packaging.

## Runtime Transport

Use HTTP for commands and WebSocket for event streaming.

Command endpoints:

```text
GET  /health
POST /runs
POST /threads/:threadId/messages
POST /runs/:runId/cancel
GET  /threads/:threadId
```

Event stream:

```text
WS /events
```

This split is intentionally boring. HTTP requests are easy to test and debug. WebSocket events let the UI receive streaming assistant text, tool events, patch proposals, completion, and failure without polling.

## Provider Boundary

Codex is the first provider, but not the shape of the whole system.

```ts
export type AgentProviderId = "codex"

export type AgentRunInput = {
  nodeId: BulletId
  threadId: ThreadId | null
  provider: "codex"
  prompt: string
  context: string
  outlineSnapshot: RuntimeOutlineSnapshot
}

export type AgentMessageInput = {
  threadId: ThreadId
  message: string
}

export type AgentProvider = {
  id: AgentProviderId
  startRun(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>
  sendMessage(input: AgentMessageInput): AsyncIterable<AgentRuntimeEvent>
  cancelRun(runId: string): Promise<void>
  getThread(threadId: string): Promise<AgentThreadSnapshot | null>
}
```

The provider receives Actionpad-shaped inputs and returns Actionpad-shaped events. Provider-specific details are stored in `providerMetadata` objects, not spread through the app model.

## Codex Integration Strategy

Start with the Codex SDK. The Codex SDK is designed for controlling local Codex agents programmatically from an app, including starting threads, continuing threads, and resuming by thread id. Official docs: [Codex SDK](https://developers.openai.com/codex/sdk).

If the SDK integration blocks basic progress, the runtime can temporarily offer a `codex exec --json` provider mode behind the same `AgentProvider` interface. That fallback should be treated as an implementation detail, not a different product mode. `codex exec` is useful for headless automation and JSON event streams, but the SDK/app-server path is a better fit for per-bullet durable conversations. Official docs: [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive) and [Codex app-server](https://developers.openai.com/codex/app-server).

## Data Model

Extend the current outline model rather than replacing it.

```ts
type RunId = string

type BulletNode = {
  id: BulletId
  parentId: BulletId | null
  children: BulletId[]
  text: string
  collapsed: boolean
  runStatus: BulletRunStatus
  threadId?: ThreadId
  activeRunId?: RunId
  metadata: Record<string, unknown>
}

type AgentThread = {
  id: ThreadId
  provider: AgentProviderId
  providerThreadId: string | null
  nodeId: BulletId
  messages: AgentMessage[]
  events: AgentEvent[]
  runs: RunId[]
}

type AgentRun = {
  id: RunId
  threadId: ThreadId
  nodeId: BulletId
  provider: AgentProviderId
  status: "queued" | "running" | "waiting_for_approval" | "succeeded" | "failed" | "cancelled"
  prompt: string
  context: string
  createdAt: number
  updatedAt: number
  error?: string
  providerMetadata: Record<string, unknown>
}
```

The current `AgentThread` model can evolve in place. `AgentRun` should be added because a thread can have multiple runs over time, even if Phase 2 starts with one run per bullet.

## Runtime Protocol

The web app sends:

```ts
type RuntimeOutlineSnapshot = {
  rootIds: BulletId[]
  nodes: Record<BulletId, { id: BulletId; parentId: BulletId | null; children: BulletId[]; text: string }>
  focusedNodeId: BulletId | null
}

type StartRunRequest = {
  nodeId: BulletId
  threadId: ThreadId | null
  provider: "codex"
  prompt: string
  context: string
  outlineSnapshot: RuntimeOutlineSnapshot
}
```

The runtime emits:

```ts
type ApprovalRequest = {
  id: string
  title: string
  body: string
}

type AgentRuntimeEvent =
  | { type: "run-started"; runId: RunId; threadId: ThreadId; nodeId: BulletId; provider: "codex" }
  | { type: "assistant-message-started"; runId: RunId; messageId: string }
  | { type: "assistant-delta"; runId: RunId; messageId: string; text: string }
  | { type: "assistant-message-completed"; runId: RunId; messageId: string; text: string }
  | { type: "tool-started"; runId: RunId; toolCallId: string; name: string; input?: unknown }
  | { type: "tool-completed"; runId: RunId; toolCallId: string; name: string; output?: unknown }
  | { type: "approval-requested"; runId: RunId; approval: ApprovalRequest }
  | { type: "outline-patch"; runId: RunId; patch: OutlinePatch }
  | { type: "run-completed"; runId: RunId }
  | { type: "run-failed"; runId: RunId; error: string }
```

The app reducer consumes these events and updates bullets, threads, runs, messages, and outline patches.

## Outline Patches

Agents do not mutate arbitrary app state. They emit structured patches.

```ts
type OutlinePatch =
  | { type: "append-child-bullets"; parentId: BulletId; bullets: BulletDraft[] }
  | { type: "update-bullet-text"; nodeId: BulletId; text: string }
  | { type: "set-bullet-run-status"; nodeId: BulletId; status: BulletRunStatus }
```

For the first Codex-backed implementation, the only patch Actionpad needs to support is:

```ts
{ type: "append-child-bullets"; parentId: BulletId; bullets: BulletDraft[] }
```

The other patch types are included in the protocol because they are natural near-term extensions, but they do not need UI controls in this phase.

## Execution Flow

When a user presses `Cmd+Enter` on a bullet without a thread:

1. The web app builds context from the bullet and its ancestors using the existing context function.
2. The web app creates a pending local `AgentThread` and `AgentRun`.
3. The web app opens the side panel and focuses the chat input.
4. The web app sends `POST /runs` to the runtime.
5. The runtime starts the Codex provider run.
6. The runtime emits `run-started`.
7. The web app marks the bullet running and links the provider thread id if present.
8. Assistant deltas stream into the side panel.
9. Tool and approval events render as event cards in the side panel.
10. The provider emits a final structured outline patch.
11. The app applies the patch as child bullets.
12. The app marks the run and bullet succeeded.

When a user presses `Cmd+Enter` on a bullet with an existing thread:

1. If the thread is idle, open the side panel and focus the chat input.
2. If the thread has an active run, open the side panel for observation.
3. Follow-up sending can be implemented through `POST /threads/:threadId/messages` after the first run path works.

## Prompt And Output Contract

The runtime should wrap user context in a system/developer instruction that tells Codex how to respond to Actionpad.

Required behavior:

- Think and work normally in the agent transcript.
- Keep durable outline output concise.
- End the run with a structured JSON patch.
- Prefer child bullets for summary, findings, proposed next actions, or implementation notes.

Initial patch extraction can use a simple delimiter contract:

```text
Return final outline output between:
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "Summarize the strongest product references." }] }
</actionpad-outline-output>
```

If Codex SDK exposes structured outputs or tool-calling hooks that make this cleaner, the provider should use those while preserving the same `OutlinePatch` shape.

## Side Panel Behavior

The side panel remains the place to inspect the full agent conversation.

It should show:

- Run status.
- User prompt/context.
- Streaming assistant message.
- Tool events.
- Approval request events, rendered inert if approval handling is not implemented yet.
- Outline patch event summary.
- Failure events with plain-language errors.

The side panel should not become the main work surface. Important results should still be written back to the outline as curated child bullets.

## Error Handling

If the runtime is offline:

- `Cmd+Enter` opens the side panel.
- The bullet run fails with a visible message: `Actionpad runtime is not running. Start the runtime and try again.`
- No child bullets are added.

If Codex is unavailable or unauthenticated:

- The runtime emits `run-failed`.
- The side panel shows the provider error in readable form.
- The bullet status becomes failed.

If an outline patch is invalid:

- The app does not apply the patch.
- The run can still complete with a visible event: `Outline output could not be applied.`
- The raw patch is retained in the thread event for inspection.

If the WebSocket disconnects:

- The app should show a connection indicator in the side panel.
- The app can recover by calling `GET /threads/:threadId`.

## Local Runtime Lifecycle

During development, start the runtime as a separate npm script:

```text
npm run dev
npm run runtime:dev
```

A later convenience script can start both together.

The runtime should listen on localhost only. The first default port should be `43217`. If unavailable, the runtime may fail with a clear message for Phase 2; automatic port discovery can wait.

The web app should read the runtime URL from a Vite environment variable:

```text
VITE_ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217
```

## Persistence

Phase 2 should keep persistence minimal.

The app owns the visible outline state. The runtime may keep in-memory run state during the process lifetime. If Codex SDK exposes durable thread ids, store the provider thread id in the app thread metadata so the app can request resume later.

Do not introduce SQLite or a file database in this phase. The next persistence step should be decided after real runs reveal what needs to survive restarts.

## Security And Permissions

The runtime can execute agent work on the user's machine, so the boundary must stay explicit.

Phase 2 constraints:

- Runtime binds to `127.0.0.1`.
- Web app talks only to the configured runtime URL.
- Provider id is restricted to `"codex"`.
- Runtime does not expose arbitrary shell execution endpoints.
- Outline patches are validated before application.
- Approval requests are represented in the UI even if approval actions are deferred.

Later desktop packaging should use an explicit sidecar/process permission model. Tauri sidecars are a plausible packaging direction because they support bundled external binaries and explicit process execution permissions. Official docs: [Tauri sidecars](https://tauri.app/es/develop/sidecar/).

## Testing Strategy

Test the runtime and app separately first, then add integration tests.

Runtime unit tests:

- `POST /runs` validates required fields.
- Runtime emits `run-started`, assistant events, outline patch, and completion for a fake provider.
- Runtime maps provider errors to `run-failed`.
- Runtime rejects unknown providers.

Provider tests:

- Codex provider is hidden behind the `AgentProvider` interface.
- Tests use a fake provider by default.
- Codex SDK integration is covered by a narrow smoke test that can be skipped when Codex is unavailable.

App tests:

- `Cmd+Enter` calls the runtime client instead of the simulator.
- Runtime events update the side panel transcript.
- `outline-patch` appends generated children.
- Runtime failure marks the bullet failed.
- Offline runtime shows a useful side-panel error.
- Existing outline editing, undo, movement, collapse, and side-panel tests remain green.

Browser QA:

- Start Vite and runtime.
- Execute a bullet with `Cmd+Enter`.
- Confirm side panel opens and streams events.
- Confirm final child bullets appear under the executed bullet.
- Confirm a bullet with an existing thread opens the same side panel.

## Implementation Slices

The implementation should be split into small commits:

1. Rename app-visible and package metadata to Actionpad.
2. Add shared runtime protocol types.
3. Add local runtime server with health endpoint and fake provider.
4. Add web runtime client and connection status.
5. Replace simulated execution with runtime fake provider.
6. Add Codex provider behind the same interface.
7. Add outline patch extraction and validation.
8. Add runtime failure and offline UI states.
9. Add manual browser QA and update docs.

## Future Work

- Desktop shell packaging.
- Runtime auto-start.
- MCP tools for `search_outline_nodes`, `append_child_bullets`, and `get_outline_context`.
- Approval actions in the side panel.
- Durable local persistence.
- Multiple provider support.
- Parallel runs and run queue controls.
- File/artifact attachments.
- Per-bullet context controls.

## Spec Review

This spec is scoped to one implementation effort: rename the prototype to Actionpad and connect executable bullets to a local Codex-backed runtime through an extensible provider interface.

It intentionally excludes desktop packaging, MCP tools, multi-provider support, and durable database design so the first real-agent version can stay small enough to verify end to end.
