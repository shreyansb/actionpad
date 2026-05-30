# Actionpad Codex Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the prototype to Actionpad and replace simulated bullet execution with a local runtime that can run Codex-backed agent tasks through an extensible provider interface.

**Architecture:** Keep the React app as the primary outline/editor UI. Add a separate local Node/TypeScript runtime with HTTP command endpoints and a WebSocket event stream. Implement and integrate a fake provider first, then add a Codex SDK provider behind the same `AgentProvider` interface.

**Tech Stack:** React 18, Vite, TypeScript, Vitest, Node `http`, `ws`, `tsx`, `@openai/codex-sdk`.

---

## File Structure

- Modify `package.json` and `package-lock.json`: rename package and add runtime scripts/dependencies.
- Modify `index.html`: browser title to Actionpad.
- Modify `src/domain/fixtures.ts`: seed root bullet text to Actionpad.
- Modify existing tests under `src/components`, `src/domain`, and `src/store`: update Actionpad naming and new run protocol expectations.
- Create `src/domain/runtimeProtocol.ts`: shared browser-safe protocol types and validation helpers.
- Modify `src/domain/types.ts`: add `RunId`, provider metadata, run tracking, runtime-flavored events, and thread/run state.
- Modify `src/domain/treeOps.ts`: keep existing tree mutations and reuse `appendChildBullets` for runtime outline patches.
- Modify `src/store/outlineReducer.ts`: add runtime event actions and outline patch application.
- Modify `src/store/OutlineStore.tsx`: replace simulated timeout execution with runtime client calls.
- Create `src/runtimeClient/runtimeClient.ts`: browser HTTP/WebSocket client.
- Create `src/runtimeClient/runtimeClient.test.ts`: client behavior tests with mocked `fetch` and `WebSocket`.
- Create `runtime/provider.ts`: runtime provider interface.
- Create `runtime/fakeProvider.ts`: deterministic fake provider for local and test execution.
- Create `runtime/codexProvider.ts`: Codex SDK-backed provider.
- Create `runtime/outlineOutput.ts`: parse and validate Actionpad outline output blocks.
- Create `runtime/server.ts`: local HTTP/WebSocket runtime server.
- Create `runtime/main.ts`: CLI entrypoint for `npm run runtime:dev`.
- Create `runtime/*.test.ts`: runtime tests in Node environment.
- Modify `src/components/ChatThreadView.tsx`, `src/components/SidePanel.tsx`, and `src/components/ChatInput.tsx`: render runtime events, failures, connection status, and eventual follow-up affordances.
- Modify `src/styles.css`: add styles for runtime failure and tool event cards.

---

## Task 1: Rename Prototype To Actionpad

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `src/domain/fixtures.ts`
- Modify: `src/domain/context.test.ts`
- Modify: `src/store/outlineReducer.test.ts`
- Modify: `src/components/OutlineView.test.tsx`
- Test: existing full test suite

- [ ] **Step 1: Write the failing naming test**

Add this assertion to `src/domain/context.test.ts` in the existing context test that checks ancestor output:

```ts
expect(context).toContain("Actionpad Prototype")
```

Run:

```bash
npm test -- src/domain/context.test.ts
```

Expected: FAIL because the fixture still emits `Executable Outliner Prototype`.

- [ ] **Step 2: Rename package metadata**

Change `package.json`:

```json
{
  "name": "actionpad",
  "version": "0.1.0",
  "private": true,
  "type": "module"
}
```

Preserve all existing scripts and dependencies in the file. Then update lockfile package names by running:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` root `name` entries become `actionpad`.

- [ ] **Step 3: Rename browser title and seed root bullet**

Change `index.html` title:

```html
<title>Actionpad</title>
```

Change `src/domain/fixtures.ts` root seed bullet:

```ts
"root-project": bullet("root-project", "Actionpad Prototype", null, [
  "research",
  "ui-exploration",
]),
```

- [ ] **Step 4: Update tests and expected text**

Replace current expected strings:

```text
Executable Outliner Prototype
```

with:

```text
Actionpad Prototype
```

Only update source/tests, not historical V1 docs.

Run:

```bash
rg -n "Executable Outliner Prototype|Executable Outliner|executable-outliner-v1" src index.html package.json package-lock.json
```

Expected: no matches in app source, current tests, package metadata, or `index.html`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

Commit:

```bash
git add package.json package-lock.json index.html src/domain/fixtures.ts src/domain/context.test.ts src/store/outlineReducer.test.ts src/components/OutlineView.test.tsx
git commit -m "chore: rename prototype to actionpad"
```

---

## Task 2: Add Shared Runtime Protocol Types

**Files:**
- Create: `src/domain/runtimeProtocol.ts`
- Create: `src/domain/runtimeProtocol.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/fixtures.ts`
- Modify: `src/store/outlineReducer.test.ts`
- Test: `src/domain/runtimeProtocol.test.ts`

- [ ] **Step 1: Write protocol validation tests**

Create `src/domain/runtimeProtocol.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { validateOutlinePatch } from "./runtimeProtocol"

describe("runtimeProtocol", () => {
  it("accepts append-child-bullets patches with non-empty text", () => {
    const result = validateOutlinePatch({
      type: "append-child-bullets",
      parentId: "research-products",
      bullets: [{ text: "Summarize the strongest product references." }],
    })

    expect(result.ok).toBe(true)
  })

  it("rejects append-child-bullets patches with blank bullet text", () => {
    const result = validateOutlinePatch({
      type: "append-child-bullets",
      parentId: "research-products",
      bullets: [{ text: "   " }],
    })

    expect(result).toEqual({ ok: false, error: "Each appended bullet needs text." })
  })

  it("rejects unknown patch types", () => {
    const result = validateOutlinePatch({ type: "replace-outline" })

    expect(result).toEqual({ ok: false, error: "Unsupported outline patch type." })
  })
})
```

Run:

```bash
npm test -- src/domain/runtimeProtocol.test.ts
```

Expected: FAIL because `runtimeProtocol.ts` does not exist.

- [ ] **Step 2: Add runtime protocol module**

Create `src/domain/runtimeProtocol.ts`:

```ts
import type { BulletDraft, BulletId, BulletRunStatus, ThreadId } from "./types"

export type RunId = string
export type AgentProviderId = "codex"

export type RuntimeOutlineSnapshot = {
  rootIds: BulletId[]
  nodes: Record<
    BulletId,
    {
      id: BulletId
      parentId: BulletId | null
      children: BulletId[]
      text: string
    }
  >
  focusedNodeId: BulletId | null
}

export type StartRunRequest = {
  nodeId: BulletId
  threadId: ThreadId | null
  provider: AgentProviderId
  prompt: string
  context: string
  outlineSnapshot: RuntimeOutlineSnapshot
}

export type AgentMessageInput = {
  threadId: ThreadId
  message: string
}

export type ApprovalRequest = {
  id: string
  title: string
  body: string
}

export type OutlinePatch =
  | { type: "append-child-bullets"; parentId: BulletId; bullets: BulletDraft[] }
  | { type: "update-bullet-text"; nodeId: BulletId; text: string }
  | { type: "set-bullet-run-status"; nodeId: BulletId; status: BulletRunStatus }

export type AgentRuntimeEvent =
  | { type: "run-started"; runId: RunId; threadId: ThreadId; nodeId: BulletId; provider: AgentProviderId; providerThreadId?: string | null }
  | { type: "assistant-message-started"; runId: RunId; messageId: string }
  | { type: "assistant-delta"; runId: RunId; messageId: string; text: string }
  | { type: "assistant-message-completed"; runId: RunId; messageId: string; text: string }
  | { type: "tool-started"; runId: RunId; toolCallId: string; name: string; input?: unknown }
  | { type: "tool-completed"; runId: RunId; toolCallId: string; name: string; output?: unknown }
  | { type: "approval-requested"; runId: RunId; approval: ApprovalRequest }
  | { type: "outline-patch"; runId: RunId; patch: OutlinePatch }
  | { type: "run-completed"; runId: RunId }
  | { type: "run-failed"; runId: RunId; error: string }

export type ValidationResult = { ok: true } | { ok: false; error: string }

export function validateOutlinePatch(value: unknown): ValidationResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Outline patch must be an object." }
  }

  const patch = value as Partial<OutlinePatch> & Record<string, unknown>
  if (patch.type === "append-child-bullets") {
    if (typeof patch.parentId !== "string" || patch.parentId.length === 0) {
      return { ok: false, error: "Append patch needs a parentId." }
    }
    if (!Array.isArray(patch.bullets)) {
      return { ok: false, error: "Append patch needs bullets." }
    }
    if (patch.bullets.some((bullet) => !bullet || typeof bullet !== "object" || typeof (bullet as BulletDraft).text !== "string" || (bullet as BulletDraft).text.trim().length === 0)) {
      return { ok: false, error: "Each appended bullet needs text." }
    }
    return { ok: true }
  }

  if (patch.type === "update-bullet-text") {
    if (typeof patch.nodeId !== "string" || typeof patch.text !== "string") {
      return { ok: false, error: "Text update patch needs nodeId and text." }
    }
    return { ok: true }
  }

  if (patch.type === "set-bullet-run-status") {
    if (typeof patch.nodeId !== "string") {
      return { ok: false, error: "Status patch needs nodeId." }
    }
    if (!["idle", "running", "succeeded", "failed"].includes(String(patch.status))) {
      return { ok: false, error: "Status patch has an unsupported status." }
    }
    return { ok: true }
  }

  return { ok: false, error: "Unsupported outline patch type." }
}
```

- [ ] **Step 3: Extend app domain types**

Modify `src/domain/types.ts` imports and types:

```ts
import type { AgentProviderId, RunId } from "./runtimeProtocol"

export type BulletNode = {
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
```

Update undo snapshots to include runs:

```ts
export type OutlineUndoSnapshot = {
  rootIds: BulletId[]
  nodes: Record<BulletId, BulletNode>
  focusedNodeId: BulletId | null
  selectedThreadId: ThreadId | null
  chatFocusRequest: number
  panelOpen: boolean
  threads: Record<ThreadId, AgentThread>
  runs: Record<RunId, AgentRun>
}
```

Update state:

```ts
export type OutlineState = OutlineUndoSnapshot & {
  undoStack: OutlineUndoSnapshot[]
}
```

Replace `AgentThread` with:

```ts
export type AgentThread = {
  id: ThreadId
  provider: AgentProviderId
  providerThreadId: string | null
  nodeId: BulletId
  messages: AgentMessage[]
  events: AgentEvent[]
  runs: RunId[]
}
```

Add:

```ts
export type AgentRun = {
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

Extend `AgentEvent`:

```ts
export type AgentEvent =
  | { type: "run-started"; nodeId: BulletId; runId?: RunId; createdAt: number }
  | { type: "message-created"; messageId: string; createdAt: number }
  | { type: "tool-started"; name: string; input?: unknown; createdAt: number }
  | { type: "tool-completed"; name: string; output?: unknown; createdAt: number }
  | { type: "approval-requested"; title: string; body: string; createdAt: number }
  | { type: "outline-output"; output: OutlineOutput; createdAt: number }
  | { type: "run-completed"; nodeId: BulletId; runId?: RunId; createdAt: number }
  | { type: "run-failed"; nodeId: BulletId; runId?: RunId; error: string; createdAt: number }
```

- [ ] **Step 4: Initialize runs in fixtures and undo**

Modify `src/domain/fixtures.ts`:

```ts
threads: {},
runs: {},
undoStack: [],
```

Modify `createUndoSnapshot` in `src/store/outlineReducer.ts` to include:

```ts
runs: Object.fromEntries(
  Object.entries(state.runs).map(([runId, run]) => [runId, { ...run, providerMetadata: { ...run.providerMetadata } }]),
),
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- src/domain/runtimeProtocol.test.ts src/store/outlineReducer.test.ts
npm test
npm run lint
```

Expected: all commands exit 0.

Commit:

```bash
git add src/domain/runtimeProtocol.ts src/domain/runtimeProtocol.test.ts src/domain/types.ts src/domain/fixtures.ts src/store/outlineReducer.ts src/store/outlineReducer.test.ts
git commit -m "feat: add actionpad runtime protocol types"
```

---

## Task 3: Add Runtime Server With Fake Provider

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `runtime/provider.ts`
- Create: `runtime/fakeProvider.ts`
- Create: `runtime/server.ts`
- Create: `runtime/main.ts`
- Create: `runtime/server.test.ts`
- Test: `runtime/server.test.ts`

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
npm install ws @openai/codex-sdk
npm install -D @types/node @types/ws tsx
```

Expected: `package.json` includes `ws` and `@openai/codex-sdk` in dependencies, and `@types/node`, `@types/ws`, plus `tsx` in devDependencies.

- [ ] **Step 2: Add runtime scripts and TypeScript include**

Add scripts in `package.json`:

```json
"runtime:dev": "tsx runtime/main.ts",
"runtime:test": "vitest run --environment node runtime"
```

Modify `tsconfig.json`:

```json
"types": ["vitest/globals", "node"],
"include": ["src", "runtime", "vite.config.ts"]
```

- [ ] **Step 3: Write server test first**

Create `runtime/server.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { createFakeProvider } from "./fakeProvider"
import { createRuntimeServer, type RuntimeServerHandle } from "./server"

let handle: RuntimeServerHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

async function readEvent(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(String(data))))
  })
}

describe("runtime server", () => {
  it("reports health", async () => {
    handle = await createRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, name: "actionpad-runtime" })
  })

  it("starts a run and streams fake provider events", async () => {
    handle = await createRuntimeServer({ port: 0, providers: [createFakeProvider()] })
    const socket = new WebSocket(`${handle.wsUrl}/events`)
    await new Promise((resolve) => socket.once("open", resolve))

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: "research-products",
        threadId: null,
        provider: "codex",
        prompt: "Find adjacent products and patterns",
        context: "Actionpad Prototype\\nResearch\\nFind adjacent products and patterns",
        outlineSnapshot: {
          rootIds: ["root-project"],
          nodes: {
            "root-project": {
              id: "root-project",
              parentId: null,
              children: ["research-products"],
              text: "Actionpad Prototype",
            },
            "research-products": {
              id: "research-products",
              parentId: "root-project",
              children: [],
              text: "Find adjacent products and patterns",
            },
          },
          focusedNodeId: "research-products",
        },
      }),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ accepted: true })
    await expect(readEvent(socket)).resolves.toMatchObject({ type: "run-started" })
    await expect(readEvent(socket)).resolves.toMatchObject({ type: "assistant-message-started" })
    await expect(readEvent(socket)).resolves.toMatchObject({ type: "assistant-delta" })
    await expect(readEvent(socket)).resolves.toMatchObject({ type: "assistant-message-completed" })
    await expect(readEvent(socket)).resolves.toMatchObject({ type: "outline-patch" })
    await expect(readEvent(socket)).resolves.toMatchObject({ type: "run-completed" })

    socket.close()
  })

  it("rejects unknown providers", async () => {
    handle = await createRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: "research-products",
        threadId: null,
        provider: "other",
        prompt: "Prompt",
        context: "Context",
        outlineSnapshot: { rootIds: [], nodes: {}, focusedNodeId: null },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Unsupported provider." })
  })
})
```

Run:

```bash
npm run runtime:test -- runtime/server.test.ts
```

Expected: FAIL because runtime files do not exist.

- [ ] **Step 4: Add provider interface**

Create `runtime/provider.ts`:

```ts
import type {
  AgentMessageInput,
  AgentProviderId,
  AgentRuntimeEvent,
  StartRunRequest,
} from "../src/domain/runtimeProtocol"
import type { ThreadId } from "../src/domain/types"

export type AgentThreadSnapshot = {
  id: ThreadId
  providerThreadId: string | null
  events: AgentRuntimeEvent[]
}

export type AgentProvider = {
  id: AgentProviderId
  startRun(input: StartRunRequest): AsyncIterable<AgentRuntimeEvent>
  sendMessage(input: AgentMessageInput): AsyncIterable<AgentRuntimeEvent>
  cancelRun(runId: string): Promise<void>
  getThread(threadId: ThreadId): Promise<AgentThreadSnapshot | null>
}
```

- [ ] **Step 5: Add fake provider**

Create `runtime/fakeProvider.ts`:

```ts
import type { AgentRuntimeEvent, StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider } from "./provider"

let runSequence = 0

function nextId(prefix: string): string {
  runSequence += 1
  return `${prefix}-${Date.now()}-${runSequence}`
}

async function* fakeRun(input: StartRunRequest): AsyncIterable<AgentRuntimeEvent> {
  const runId = nextId("run")
  const threadId = input.threadId ?? nextId("thread")
  const messageId = nextId("message")

  yield { type: "run-started", runId, threadId, nodeId: input.nodeId, provider: "codex", providerThreadId: threadId }
  yield { type: "assistant-message-started", runId, messageId }
  yield {
    type: "assistant-delta",
    runId,
    messageId,
    text: `I am using the Actionpad runtime to work on: ${input.prompt}`,
  }
  yield {
    type: "assistant-message-completed",
    runId,
    messageId,
    text: `I am using the Actionpad runtime to work on: ${input.prompt}`,
  }
  yield {
    type: "outline-patch",
    runId,
    patch: {
      type: "append-child-bullets",
      parentId: input.nodeId,
      bullets: [
        { text: `Clarify the desired outcome for "${input.prompt}".` },
        { text: "Identify the smallest useful next action." },
        { text: "Capture follow-up questions as child bullets." },
      ],
    },
  }
  yield { type: "run-completed", runId }
}

export function createFakeProvider(): AgentProvider {
  return {
    id: "codex",
    startRun: fakeRun,
    async *sendMessage() {
      throw new Error("Follow-up messages are not implemented in the fake provider.")
    },
    async cancelRun() {},
    async getThread() {
      return null
    },
  }
}
```

- [ ] **Step 6: Add runtime server**

Create `runtime/server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import WebSocket, { WebSocketServer } from "ws"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider } from "./provider"

export type RuntimeServerHandle = {
  url: string
  wsUrl: string
  close: () => Promise<void>
}

type RuntimeServerOptions = {
  port: number
  providers: AgentProvider[]
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  })
  response.end(JSON.stringify(body))
}

function isStartRunRequest(value: unknown): value is StartRunRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Partial<StartRunRequest>
  return (
    typeof request.nodeId === "string" &&
    (typeof request.threadId === "string" || request.threadId === null) &&
    request.provider === "codex" &&
    typeof request.prompt === "string" &&
    typeof request.context === "string" &&
    Boolean(request.outlineSnapshot)
  )
}

export async function createRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServerHandle> {
  const providers = new Map(options.providers.map((provider) => [provider.id, provider]))
  const sockets = new Set<WebSocket>()

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {})
      return
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, name: "actionpad-runtime" })
      return
    }

    if (request.method === "POST" && request.url === "/runs") {
      const body = await readJson(request)
      if (!isStartRunRequest(body)) {
        sendJson(response, 400, { error: "Invalid run request." })
        return
      }

      const provider = providers.get(body.provider)
      if (!provider) {
        sendJson(response, 400, { error: "Unsupported provider." })
        return
      }

      sendJson(response, 202, { accepted: true })
      queueMicrotask(async () => {
        try {
          for await (const event of provider.startRun(body)) {
            const payload = JSON.stringify(event)
            for (const socket of sockets) {
              if (socket.readyState === WebSocket.OPEN) socket.send(payload)
            }
          }
        } catch (error) {
          const payload = JSON.stringify({
            type: "run-failed",
            runId: "unknown",
            error: error instanceof Error ? error.message : "Runtime provider failed.",
          })
          for (const socket of sockets) {
            if (socket.readyState === WebSocket.OPEN) socket.send(payload)
          }
        }
      })
      return
    }

    sendJson(response, 404, { error: "Not found." })
  })

  const webSocketServer = new WebSocketServer({ server, path: "/events" })
  webSocketServer.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.close()
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
```

- [ ] **Step 7: Add runtime entrypoint**

Create `runtime/main.ts`:

```ts
import { createFakeProvider } from "./fakeProvider"
import { createRuntimeServer } from "./server"

const port = Number(process.env.ACTIONPAD_RUNTIME_PORT ?? "43217")

const server = await createRuntimeServer({
  port,
  providers: [createFakeProvider()],
})

console.log(`Actionpad runtime listening at ${server.url}`)

function shutdown() {
  server.close().finally(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
npm run runtime:test -- runtime/server.test.ts
npm test
npm run lint
```

Expected: all commands exit 0.

Commit:

```bash
git add package.json package-lock.json tsconfig.json runtime/provider.ts runtime/fakeProvider.ts runtime/server.ts runtime/main.ts runtime/server.test.ts
git commit -m "feat: add actionpad runtime server"
```

---

## Task 4: Add Browser Runtime Client

**Files:**
- Create: `src/runtimeClient/runtimeClient.ts`
- Create: `src/runtimeClient/runtimeClient.test.ts`
- Test: `src/runtimeClient/runtimeClient.test.ts`

- [ ] **Step 1: Write client tests**

Create `src/runtimeClient/runtimeClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActionpadRuntimeClient } from "./runtimeClient"

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  url: string

  constructor(url: string) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close() {}

  emitMessage(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }))
  }
}

describe("ActionpadRuntimeClient", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    MockWebSocket.instances = []
  })

  it("starts a run with the configured runtime URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")
    await client.startRun({
      nodeId: "research-products",
      threadId: null,
      provider: "codex",
      prompt: "Find adjacent products and patterns",
      context: "Actionpad Prototype\\nResearch\\nFind adjacent products and patterns",
      outlineSnapshot: { rootIds: [], nodes: {}, focusedNodeId: "research-products" },
    })

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:43217/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining("research-products"),
    })
  })

  it("subscribes to runtime events", () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")
    const received: unknown[] = []

    const unsubscribe = client.subscribe((event) => received.push(event))
    MockWebSocket.instances[0].emitMessage({ type: "run-completed", runId: "run-1" })

    expect(MockWebSocket.instances[0].url).toBe("ws://127.0.0.1:43217/events")
    expect(received).toEqual([{ type: "run-completed", runId: "run-1" }])
    unsubscribe()
  })
})
```

Run:

```bash
npm test -- src/runtimeClient/runtimeClient.test.ts
```

Expected: FAIL because `runtimeClient.ts` does not exist.

- [ ] **Step 2: Add runtime client**

Create `src/runtimeClient/runtimeClient.ts`:

```ts
import type { AgentRuntimeEvent, StartRunRequest } from "../domain/runtimeProtocol"

export class ActionpadRuntimeClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
  }

  async startRun(request: StartRunRequest): Promise<void> {
    const response = await fetch(`${this.baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? "Actionpad runtime rejected the run.")
    }
  }

  subscribe(onEvent: (event: AgentRuntimeEvent) => void, onConnectionChange?: (connected: boolean) => void): () => void {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = "/events"

    const socket = new WebSocket(url.toString())
    socket.addEventListener("open", () => onConnectionChange?.(true))
    socket.addEventListener("close", () => onConnectionChange?.(false))
    socket.addEventListener("message", (message) => {
      onEvent(JSON.parse(String(message.data)) as AgentRuntimeEvent)
    })

    return () => socket.close()
  }
}

export function getRuntimeUrl(): string {
  return import.meta.env.VITE_ACTIONPAD_RUNTIME_URL ?? "http://127.0.0.1:43217"
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- src/runtimeClient/runtimeClient.test.ts
npm test
npm run lint
```

Expected: all commands exit 0.

Commit:

```bash
git add src/runtimeClient/runtimeClient.ts src/runtimeClient/runtimeClient.test.ts
git commit -m "feat: add actionpad runtime client"
```

---

## Task 5: Consume Runtime Events In The App Reducer

**Files:**
- Modify: `src/store/outlineReducer.ts`
- Modify: `src/store/outlineReducer.test.ts`
- Modify: `src/domain/types.ts`
- Test: `src/store/outlineReducer.test.ts`

- [ ] **Step 1: Write reducer tests for runtime events**

Add tests to `src/store/outlineReducer.test.ts`:

```ts
it("starts a runtime run and stores thread/run state", () => {
  const state = createInitialOutlineState()
  const next = outlineReducer(state, {
    type: "runtime-event",
    event: {
      type: "run-started",
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      provider: "codex",
      providerThreadId: "codex-thread-1",
    },
    createdAt: 100,
    context: "Actionpad Prototype\nResearch\nFind adjacent products and patterns",
  })

  expect(next.nodes["research-products"].runStatus).toBe("running")
  expect(next.nodes["research-products"].threadId).toBe("thread-1")
  expect(next.nodes["research-products"].activeRunId).toBe("run-1")
  expect(next.threads["thread-1"].providerThreadId).toBe("codex-thread-1")
  expect(next.runs["run-1"].status).toBe("running")
})

it("appends assistant deltas and applies outline patches from runtime events", () => {
  const running = outlineReducer(createInitialOutlineState(), {
    type: "runtime-event",
    event: {
      type: "run-started",
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      provider: "codex",
      providerThreadId: "codex-thread-1",
    },
    createdAt: 100,
    context: "context",
  })
  const startedMessage = outlineReducer(running, {
    type: "runtime-event",
    event: { type: "assistant-message-started", runId: "run-1", messageId: "message-1" },
    createdAt: 101,
  })
  const withDelta = outlineReducer(startedMessage, {
    type: "runtime-event",
    event: { type: "assistant-delta", runId: "run-1", messageId: "message-1", text: "Working." },
    createdAt: 102,
  })
  const withPatch = outlineReducer(withDelta, {
    type: "runtime-event",
    event: {
      type: "outline-patch",
      runId: "run-1",
      patch: {
        type: "append-child-bullets",
        parentId: "research-products",
        bullets: [{ text: "First generated child." }],
      },
    },
    createdAt: 103,
    generatedIds: ["generated-1"],
  })
  const completed = outlineReducer(withPatch, {
    type: "runtime-event",
    event: { type: "run-completed", runId: "run-1" },
    createdAt: 104,
  })

  expect(completed.threads["thread-1"].messages).toContainEqual(
    expect.objectContaining({ id: "message-1", content: "Working.", status: "streaming" }),
  )
  expect(completed.nodes["research-products"].children).toEqual(["generated-1"])
  expect(completed.nodes["generated-1"].metadata.generated).toBe(true)
  expect(completed.nodes["research-products"].runStatus).toBe("succeeded")
  expect(completed.runs["run-1"].status).toBe("succeeded")
})
```

Run:

```bash
npm test -- src/store/outlineReducer.test.ts
```

Expected: FAIL because `runtime-event` is not handled.

- [ ] **Step 2: Add runtime reducer action**

In `src/store/outlineReducer.ts`, import:

```ts
import type { AgentRuntimeEvent } from "../domain/runtimeProtocol"
```

Add action:

```ts
| {
    type: "runtime-event"
    event: AgentRuntimeEvent
    createdAt: number
    context?: string
    generatedIds?: BulletId[]
  }
```

- [ ] **Step 3: Handle runtime events**

Add a reducer case before the legacy `run-started` case:

```ts
case "runtime-event":
  return applyRuntimeEvent(state, action.event, action.createdAt, action.context, action.generatedIds)
```

Add helper functions below `withUndo`:

```ts
function findThreadIdForRun(state: OutlineState, runId: string): ThreadId | null {
  return state.runs[runId]?.threadId ?? null
}

function appendGeneratedIds(bullets: BulletDraft[], ids: BulletId[]): DraftWithId[] {
  return bullets.map((bullet, index) => ({ ...bullet, id: ids[index] }))
}
```

Add `applyRuntimeEvent` with these branches:

```ts
function applyRuntimeEvent(
  state: OutlineState,
  event: AgentRuntimeEvent,
  createdAt: number,
  context = "",
  generatedIds: BulletId[] = [],
): OutlineState {
  if (event.type === "run-started") {
    const node = state.nodes[event.nodeId]
    if (!node) return state
    return withUndo(state, {
      ...state,
      focusedNodeId: event.nodeId,
      selectedThreadId: event.threadId,
      panelOpen: true,
      nodes: {
        ...state.nodes,
        [event.nodeId]: {
          ...node,
          runStatus: "running",
          threadId: event.threadId,
          activeRunId: event.runId,
        },
      },
      threads: {
        ...state.threads,
        [event.threadId]: {
          id: event.threadId,
          provider: event.provider,
          providerThreadId: event.providerThreadId ?? null,
          nodeId: event.nodeId,
          messages: [
            {
              id: `${event.runId}-user`,
              role: "user",
              content: context,
              createdAt,
              status: "complete",
            },
          ],
          events: [{ type: "run-started", nodeId: event.nodeId, runId: event.runId, createdAt }],
          runs: [event.runId],
        },
      },
      runs: {
        ...state.runs,
        [event.runId]: {
          id: event.runId,
          threadId: event.threadId,
          nodeId: event.nodeId,
          provider: event.provider,
          status: "running",
          prompt: node.text,
          context,
          createdAt,
          updatedAt: createdAt,
          providerMetadata: {},
        },
      },
    })
  }

  const threadId = findThreadIdForRun(state, event.runId)
  if (!threadId) return state
  const thread = state.threads[threadId]
  const run = state.runs[event.runId]
  if (!thread || !run) return state

  if (event.type === "assistant-message-started") {
    return {
      ...state,
      threads: {
        ...state.threads,
        [threadId]: {
          ...thread,
          messages: [
            ...thread.messages,
            { id: event.messageId, role: "assistant", content: "", createdAt, status: "streaming" },
          ],
        },
      },
    }
  }

  if (event.type === "assistant-delta") {
    return {
      ...state,
      threads: {
        ...state.threads,
        [threadId]: {
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === event.messageId
              ? { ...message, content: `${message.content}${event.text}`, status: "streaming" }
              : message,
          ),
        },
      },
    }
  }

  if (event.type === "assistant-message-completed") {
    return {
      ...state,
      threads: {
        ...state.threads,
        [threadId]: {
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === event.messageId
              ? { ...message, content: event.text, status: "complete" }
              : message,
          ),
        },
      },
    }
  }

  if (event.type === "outline-patch" && event.patch.type === "append-child-bullets") {
    if (generatedIds.length !== event.patch.bullets.length) return state
    const withChildren = appendChildBullets(
      state,
      event.patch.parentId,
      appendGeneratedIds(event.patch.bullets, generatedIds),
    )
    if (withChildren === state) return state
    return withUndo(state, {
      ...withChildren,
      threads: {
        ...withChildren.threads,
        [threadId]: {
          ...thread,
          events: [
            ...thread.events,
            { type: "outline-output", output: event.patch, createdAt },
          ],
        },
      },
    })
  }

  if (event.type === "run-completed") {
    const node = state.nodes[run.nodeId]
    return {
      ...state,
      nodes: node
        ? {
            ...state.nodes,
            [run.nodeId]: { ...node, runStatus: "succeeded", activeRunId: undefined },
          }
        : state.nodes,
      threads: {
        ...state.threads,
        [threadId]: {
          ...thread,
          events: [...thread.events, { type: "run-completed", nodeId: run.nodeId, runId: run.id, createdAt }],
        },
      },
      runs: {
        ...state.runs,
        [run.id]: { ...run, status: "succeeded", updatedAt: createdAt },
      },
    }
  }

  if (event.type === "run-failed") {
    const node = state.nodes[run.nodeId]
    return {
      ...state,
      nodes: node
        ? {
            ...state.nodes,
            [run.nodeId]: { ...node, runStatus: "failed", activeRunId: undefined },
          }
        : state.nodes,
      threads: {
        ...state.threads,
        [threadId]: {
          ...thread,
          events: [
            ...thread.events,
            { type: "run-failed", nodeId: run.nodeId, runId: run.id, error: event.error, createdAt },
          ],
        },
      },
      runs: {
        ...state.runs,
        [run.id]: { ...run, status: "failed", error: event.error, updatedAt: createdAt },
      },
    }
  }

  return state
}
```

- [ ] **Step 4: Update legacy run-started thread shape**

In the existing `run-started` legacy branch, update new thread creation:

```ts
[action.threadId]: {
  id: action.threadId,
  provider: "codex",
  providerThreadId: null,
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
  runs: [],
},
```

This keeps old tests passing until the simulated path is removed in Task 7.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- src/store/outlineReducer.test.ts
npm test
npm run lint
```

Expected: all commands exit 0.

Commit:

```bash
git add src/store/outlineReducer.ts src/store/outlineReducer.test.ts src/domain/types.ts
git commit -m "feat: consume actionpad runtime events"
```

---

## Task 6: Wire Runtime Client Into OutlineStore With Fake Runtime

**Files:**
- Modify: `src/store/OutlineStore.tsx`
- Modify: `src/components/SidePanel.tsx`
- Modify: `src/components/SidePanel.test.tsx`
- Test: `src/components/SidePanel.test.tsx`

- [ ] **Step 1: Write integration test around runtime client behavior**

In `src/components/SidePanel.test.tsx`, mock `fetch` and `WebSocket` at the top of the file using the same `MockWebSocket` pattern from `runtimeClient.test.ts`. Add a test:

```ts
test("cmd enter sends focused bullet context to the runtime", async () => {
  const user = userEvent.setup()
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accepted: true }) })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("WebSocket", MockWebSocket)
  render(<App />)

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:43217/runs",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Actionpad Prototype"),
    }),
  )
  expect(await screen.findByRole("complementary", { name: /bullet chat panel/i })).toBeInTheDocument()
})
```

Run:

```bash
npm test -- src/components/SidePanel.test.tsx
```

Expected: FAIL because `OutlineStore` still uses the simulator and does not call `fetch`.

- [ ] **Step 2: Subscribe to runtime events in OutlineStore**

In `src/store/OutlineStore.tsx`, remove `createSimulatedOutput` import and timeout handling. Add:

```ts
import { ActionpadRuntimeClient, getRuntimeUrl } from "../runtimeClient/runtimeClient"
```

Create the client:

```ts
const runtimeClientRef = useRef<ActionpadRuntimeClient | null>(null)

if (!runtimeClientRef.current) {
  runtimeClientRef.current = new ActionpadRuntimeClient(getRuntimeUrl())
}
```

Add subscription effect:

```ts
useEffect(() => {
  const client = runtimeClientRef.current
  if (!client) return
  return client.subscribe((event) => {
    const generatedIds =
      event.type === "outline-patch" && event.patch.type === "append-child-bullets"
        ? event.patch.bullets.map(() => nextId("generated"))
        : undefined
    dispatch({ type: "runtime-event", event, createdAt: Date.now(), generatedIds })
  })
}, [])
```

- [ ] **Step 3: Replace executeNode simulator call**

Replace the no-thread `executeNode` path in `src/store/OutlineStore.tsx`:

```ts
const threadId = nextId("thread")
const context = buildRunContext(nodeId, state)
dispatch({ type: "select-thread", threadId })
dispatch({ type: "open-panel" })
dispatch({ type: "request-chat-focus" })

runtimeClientRef.current
  ?.startRun({
    nodeId,
    threadId,
    provider: "codex",
    prompt: node.text,
    context,
    outlineSnapshot: {
      rootIds: state.rootIds,
      focusedNodeId: state.focusedNodeId,
      nodes: Object.fromEntries(
        Object.entries(state.nodes).map(([id, outlineNode]) => [
          id,
          {
            id: outlineNode.id,
            parentId: outlineNode.parentId,
            children: outlineNode.children,
            text: outlineNode.text,
          },
        ]),
      ),
    },
  })
  .catch((error) => {
    dispatch({
      type: "runtime-event",
      event: {
        type: "run-failed",
        runId: nextId("failed-run"),
        error: error instanceof Error ? error.message : "Actionpad runtime is not running. Start the runtime and try again.",
      },
      createdAt: Date.now(),
    })
  })
```

Keep the existing thread path:

```ts
if (node.threadId) {
  dispatch({ type: "select-thread", threadId: node.threadId })
  dispatch({ type: "open-panel" })
  dispatch({ type: "request-chat-focus" })
  return
}
```

- [ ] **Step 4: Render connection status in side panel**

If the reducer has not yet stored connection status, keep this step minimal: render offline errors through events and leave live connection indicator for Task 8. No extra state is required in this task.

- [ ] **Step 5: Verify with fake runtime manually**

Start runtime:

```bash
npm run runtime:dev
```

Start app:

```bash
npm run dev
```

In the browser at `http://127.0.0.1:5173/`, press `Cmd+Enter` on `Find adjacent products and patterns`.

Expected:

- Side panel opens.
- Assistant text streams from fake runtime.
- Three child bullets appear under the executed bullet.
- Chat icon appears on the executed bullet.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- src/components/SidePanel.test.tsx src/store/outlineReducer.test.ts
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

Commit:

```bash
git add src/store/OutlineStore.tsx src/components/SidePanel.tsx src/components/SidePanel.test.tsx
git commit -m "feat: run bullets through actionpad runtime"
```

---

## Task 7: Add Outline Output Parsing And Codex Provider

**Files:**
- Create: `runtime/outlineOutput.ts`
- Create: `runtime/outlineOutput.test.ts`
- Create: `runtime/codexProvider.ts`
- Modify: `runtime/main.ts`
- Test: `runtime/outlineOutput.test.ts`

- [ ] **Step 1: Write outline output parsing tests**

Create `runtime/outlineOutput.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { extractOutlinePatch } from "./outlineOutput"

describe("outlineOutput", () => {
  it("extracts append-child-bullets patch from Actionpad delimiters", () => {
    const patch = extractOutlinePatch(`
Here is my summary.
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "Compare Workflowy and Taskade." }] }
</actionpad-outline-output>
`)

    expect(patch).toEqual({
      type: "append-child-bullets",
      parentId: "research-products",
      bullets: [{ text: "Compare Workflowy and Taskade." }],
    })
  })

  it("returns a validation error for invalid patch JSON", () => {
    const patch = extractOutlinePatch(`
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "" }] }
</actionpad-outline-output>
`)

    expect(patch).toEqual({ error: "Each appended bullet needs text." })
  })
})
```

Run:

```bash
npm run runtime:test -- runtime/outlineOutput.test.ts
```

Expected: FAIL because `outlineOutput.ts` does not exist.

- [ ] **Step 2: Implement outline output parsing**

Create `runtime/outlineOutput.ts`:

```ts
import type { OutlinePatch } from "../src/domain/runtimeProtocol"
import { validateOutlinePatch } from "../src/domain/runtimeProtocol"

type OutlinePatchResult = OutlinePatch | { error: string }

const START = "<actionpad-outline-output>"
const END = "</actionpad-outline-output>"

export function extractOutlinePatch(text: string): OutlinePatchResult {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1 || end <= start) {
    return { error: "No Actionpad outline output block found." }
  }

  const json = text.slice(start + START.length, end).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: "Outline output block is not valid JSON." }
  }

  const validation = validateOutlinePatch(parsed)
  if (!validation.ok) return { error: validation.error }
  return parsed as OutlinePatch
}
```

- [ ] **Step 3: Add Codex provider skeleton**

Create `runtime/codexProvider.ts`:

```ts
import { Codex } from "@openai/codex-sdk"
import type { AgentRuntimeEvent, StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider } from "./provider"
import { extractOutlinePatch } from "./outlineOutput"

function buildActionpadPrompt(input: StartRunRequest): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    "The patch must append child bullets under the executing bullet.",
    `Executing bullet id: ${input.nodeId}`,
    "Context:",
    input.context,
  ].join("\n\n")
}

export function createCodexProvider(): AgentProvider {
  const codex = new Codex()

  return {
    id: "codex",
    async *startRun(input: StartRunRequest): AsyncIterable<AgentRuntimeEvent> {
      const runId = `run-${Date.now()}`
      const threadId = input.threadId ?? `thread-${Date.now()}`
      const messageId = `message-${Date.now()}`

      yield { type: "run-started", runId, threadId, nodeId: input.nodeId, provider: "codex", providerThreadId: threadId }
      yield { type: "assistant-message-started", runId, messageId }

      const thread = codex.startThread()
      const result = await thread.run(buildActionpadPrompt(input))
      const text = String((result as { finalResponse?: unknown }).finalResponse ?? result)

      yield { type: "assistant-delta", runId, messageId, text }
      yield { type: "assistant-message-completed", runId, messageId, text }

      const patch = extractOutlinePatch(text)
      if ("error" in patch) {
        yield { type: "run-failed", runId, error: patch.error }
        return
      }

      yield { type: "outline-patch", runId, patch }
      yield { type: "run-completed", runId }
    },
    async *sendMessage() {
      throw new Error("Codex follow-up messages are not implemented in Phase 2.")
    },
    async cancelRun() {},
    async getThread() {
      return null
    },
  }
}
```

If the SDK API differs from this shape, adapt only `runtime/codexProvider.ts`. Keep the `AgentProvider` interface unchanged.

- [ ] **Step 4: Select fake or Codex provider in runtime main**

Modify `runtime/main.ts`:

```ts
import { createCodexProvider } from "./codexProvider"
import { createFakeProvider } from "./fakeProvider"
import { createRuntimeServer } from "./server"

const port = Number(process.env.ACTIONPAD_RUNTIME_PORT ?? "43217")
const provider = process.env.ACTIONPAD_PROVIDER === "fake" ? createFakeProvider() : createCodexProvider()

const server = await createRuntimeServer({
  port,
  providers: [provider],
})

console.log(`Actionpad runtime listening at ${server.url}`)
console.log(`Actionpad provider: ${provider.id}${process.env.ACTIONPAD_PROVIDER === "fake" ? " fake" : ""}`)

function shutdown() {
  server.close().finally(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
```

- [ ] **Step 5: Verify parser and fake runtime**

Run:

```bash
npm run runtime:test -- runtime/outlineOutput.test.ts runtime/server.test.ts
ACTIONPAD_PROVIDER=fake npm run runtime:dev
```

Expected:

- Runtime tests pass.
- Runtime starts with fake provider.

- [ ] **Step 6: Optional Codex smoke test**

Only run this if Codex SDK credentials are available locally:

```bash
npm run runtime:dev
```

Then in another terminal:

```bash
curl -s -X POST http://127.0.0.1:43217/runs \
  -H 'content-type: application/json' \
  -d '{"nodeId":"research-products","threadId":null,"provider":"codex","prompt":"Create one child bullet saying hello from Codex.","context":"Actionpad Prototype\nResearch\nCreate one child bullet saying hello from Codex.","outlineSnapshot":{"rootIds":[],"nodes":{},"focusedNodeId":"research-products"}}'
```

Expected: HTTP 202. Runtime logs should show no startup crash. Event inspection can be done through the app in Task 9.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run runtime:test
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

Commit:

```bash
git add runtime/outlineOutput.ts runtime/outlineOutput.test.ts runtime/codexProvider.ts runtime/main.ts package.json package-lock.json
git commit -m "feat: add codex runtime provider"
```

---

## Task 8: Runtime Failure And Offline States

**Files:**
- Modify: `src/store/OutlineStore.tsx`
- Modify: `src/store/outlineReducer.ts`
- Modify: `src/components/ChatThreadView.tsx`
- Modify: `src/components/SidePanel.test.tsx`
- Modify: `src/styles.css`
- Test: `src/components/SidePanel.test.tsx`

- [ ] **Step 1: Write offline runtime test**

Add to `src/components/SidePanel.test.tsx`:

```ts
test("runtime startup failure marks the bullet failed with a useful message", async () => {
  const user = userEvent.setup()
  vi.stubGlobal("WebSocket", MockWebSocket)
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:43217")),
  )
  render(<App />)

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(await within(panel).findByText(/Actionpad runtime is not running/i)).toBeInTheDocument()
  expect(within(panel).getByText("failed")).toBeInTheDocument()
})
```

Run:

```bash
npm test -- src/components/SidePanel.test.tsx
```

Expected: FAIL until offline failure creates a local failed run/thread.

- [ ] **Step 2: Create local failed thread when startRun rejects**

In `src/store/OutlineStore.tsx`, when `startRun` rejects, dispatch a dedicated action instead of a `runtime-event` with an unknown run:

```ts
dispatch({
  type: "run-failed-local",
  nodeId,
  threadId,
  runId: nextId("failed-run"),
  context,
  error: "Actionpad runtime is not running. Start the runtime and try again.",
  createdAt: Date.now(),
})
```

Add reducer action in `src/store/outlineReducer.ts`:

```ts
| {
    type: "run-failed-local"
    nodeId: BulletId
    threadId: ThreadId
    runId: RunId
    context: string
    error: string
    createdAt: number
  }
```

Implement reducer case:

```ts
case "run-failed-local": {
  const node = state.nodes[action.nodeId]
  if (!node) return state
  return {
    ...state,
    selectedThreadId: action.threadId,
    panelOpen: true,
    nodes: {
      ...state.nodes,
      [action.nodeId]: { ...node, runStatus: "failed", threadId: action.threadId, activeRunId: undefined },
    },
    threads: {
      ...state.threads,
      [action.threadId]: {
        id: action.threadId,
        provider: "codex",
        providerThreadId: null,
        nodeId: action.nodeId,
        messages: [
          { id: `${action.runId}-user`, role: "user", content: action.context, createdAt: action.createdAt, status: "complete" },
        ],
        events: [
          { type: "run-started", nodeId: action.nodeId, runId: action.runId, createdAt: action.createdAt },
          { type: "run-failed", nodeId: action.nodeId, runId: action.runId, error: action.error, createdAt: action.createdAt },
        ],
        runs: [action.runId],
      },
    },
    runs: {
      ...state.runs,
      [action.runId]: {
        id: action.runId,
        threadId: action.threadId,
        nodeId: action.nodeId,
        provider: "codex",
        status: "failed",
        prompt: node.text,
        context: action.context,
        createdAt: action.createdAt,
        updatedAt: action.createdAt,
        error: action.error,
        providerMetadata: {},
      },
    },
  }
}
```

- [ ] **Step 3: Render failure events**

Modify `src/components/ChatThreadView.tsx` event rendering:

```tsx
{events.map((event, index) => {
  if (event.type === "outline-output") {
    return (
      <article key={`${event.createdAt}-${index}`} className="event-card">
        <strong>Outline output</strong>
        {event.output.type === "append-child-bullets" ? (
          <p>Appended {event.output.bullets.length} child bullets.</p>
        ) : (
          <p>Updated outline state.</p>
        )}
      </article>
    )
  }
  if (event.type === "run-failed") {
    return (
      <article key={`${event.createdAt}-${index}`} className="event-card is-error">
        <strong>Run failed</strong>
        <p>{event.error}</p>
      </article>
    )
  }
  if (event.type === "tool-started" || event.type === "tool-completed") {
    return (
      <article key={`${event.createdAt}-${index}`} className="event-card">
        <strong>{event.type === "tool-started" ? "Tool started" : "Tool completed"}</strong>
        <p>{event.name}</p>
      </article>
    )
  }
  return null
})}
```

Add CSS:

```css
.event-card.is-error {
  border-color: #e5b7b7;
  background: #fff6f6;
  color: #822727;
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- src/components/SidePanel.test.tsx src/store/outlineReducer.test.ts
npm test
npm run lint
```

Expected: all commands exit 0.

Commit:

```bash
git add src/store/OutlineStore.tsx src/store/outlineReducer.ts src/components/ChatThreadView.tsx src/components/SidePanel.test.tsx src/styles.css
git commit -m "feat: show actionpad runtime failures"
```

---

## Task 9: End-To-End Browser QA And Docs

**Files:**
- Create: `docs/actionpad-runtime.md`
- Modify: `README.md` if present, otherwise no README change.
- Test: manual browser QA

- [ ] **Step 1: Add runtime usage docs**

Create `docs/actionpad-runtime.md`:

```md
# Actionpad Runtime

Actionpad uses a local runtime process for executable bullets.

## Development

Start the web app:

```bash
npm run dev
```

Start the runtime with the deterministic fake provider:

```bash
ACTIONPAD_PROVIDER=fake npm run runtime:dev
```

Start the runtime with Codex:

```bash
npm run runtime:dev
```

The runtime listens on `http://127.0.0.1:43217`.

The web app reads the runtime URL from:

```bash
VITE_ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217
```

## Expected Flow

1. Focus a bullet.
2. Press `Cmd+Enter`.
3. The side panel opens.
4. The runtime streams assistant and event output.
5. The final outline patch appends child bullets under the executed bullet.

## Troubleshooting

If the runtime is not running, Actionpad shows a failed run in the side panel with this message:

`Actionpad runtime is not running. Start the runtime and try again.`
```

- [ ] **Step 2: Run automated verification**

Run:

```bash
npm run runtime:test
npm test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Manual browser QA with fake runtime**

Terminal 1:

```bash
ACTIONPAD_PROVIDER=fake npm run runtime:dev
```

Terminal 2:

```bash
npm run dev
```

Browser QA at `http://127.0.0.1:5173/`:

- Focus `Find adjacent products and patterns`.
- Press `Cmd+Enter`.
- Confirm side panel opens.
- Confirm user context appears.
- Confirm assistant message appears.
- Confirm `Outline output` event appears.
- Confirm three generated child bullets appear.
- Close and reopen the panel by pressing `Cmd+Enter` again on the same bullet.
- Stop the runtime.
- Execute another threadless bullet.
- Confirm failure event appears with the runtime-not-running message.

- [ ] **Step 4: Manual browser QA with Codex runtime**

Only run this if local Codex SDK auth is configured.

Terminal 1:

```bash
npm run runtime:dev
```

Terminal 2:

```bash
npm run dev
```

Browser QA:

- Create a new bullet: `Create two child bullets about why Actionpad should stay outline-first.`
- Press `Cmd+Enter`.
- Confirm side panel opens and receives Codex output.
- Confirm child bullets are appended if Codex emits a valid Actionpad outline output block.
- If Codex emits invalid output, confirm the run failure is visible and no malformed child bullets are added.

- [ ] **Step 5: Commit docs and any final QA fixes**

Run:

```bash
git status --short
```

Commit:

```bash
git add docs/actionpad-runtime.md
git commit -m "docs: document actionpad runtime"
```

If final QA required source fixes, include only those scoped files in the commit and use:

```bash
git commit -m "fix: polish actionpad runtime integration"
```

---

## Self-Review

Spec coverage:

- Rename to Actionpad: Task 1.
- Local runtime process: Task 3.
- HTTP command API and WebSocket event stream: Task 3.
- Shared provider interface: Task 3.
- Runtime client: Task 4.
- Runtime-driven app execution: Tasks 5 and 6.
- Codex SDK provider: Task 7.
- Structured outline patches and validation: Tasks 2, 5, and 7.
- Side-panel runtime transcript and errors: Tasks 5, 6, and 8.
- Testing and browser QA: every task includes automated tests; Task 9 covers manual browser QA.

Placeholder scan:

- The plan contains no TBD markers, no unresolved file paths, and no intentionally vague implementation steps.

Type consistency:

- `AgentRuntimeEvent`, `StartRunRequest`, `OutlinePatch`, `RunId`, and `AgentProviderId` are introduced in Task 2 and reused consistently by runtime, client, reducer, and provider tasks.
