# Actionpad Real Codex Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ACTIONPAD_PROVIDER=codex` run real local Codex SDK tasks with streamed events, validated outline output, and explicit runtime configuration.

**Architecture:** Keep the browser and runtime protocol provider-neutral. Add a runtime config module, a parent-safe outline output parser, a tested Codex SDK event mapper, and a streaming Codex provider that uses `Thread.runStreamed(...)`. Fake provider remains the default deterministic provider.

**Tech Stack:** React 18, Vite, TypeScript, Vitest, Node `http`, `ws`, `tsx`, `@openai/codex-sdk`.

---

## File Structure

- Create `runtime/codexConfig.ts`: parse and validate runtime/Codex environment configuration.
- Create `runtime/codexConfig.test.ts`: config defaults and invalid-value tests.
- Modify `runtime/outlineOutput.ts`: allow validating that emitted patches target the executing bullet.
- Modify `runtime/outlineOutput.test.ts`: missing block, invalid JSON, wrong parent, valid parent coverage.
- Create `runtime/codexEventMapper.ts`: translate Codex SDK `ThreadEvent` values into Actionpad `AgentProviderEvent` values and aggregate final assistant text.
- Create `runtime/codexEventMapper.test.ts`: pure unit tests using mocked SDK-shaped events.
- Modify `runtime/codexProvider.ts`: use `runStreamed`, injectable Codex client/thread for tests, config-driven thread options, active-run cancellation, provider thread snapshots.
- Create `runtime/codexProvider.test.ts`: provider tests with fake Codex client/thread, no real Codex process.
- Modify `runtime/main.ts`: parse config, choose provider, log runtime safety settings.
- Modify `src/domain/types.ts` and `src/components/ChatThreadView.tsx` only if needed for approval/error event rendering.
- Modify `src/components/SidePanel.test.tsx` only if UI event rendering changes.
- Modify `docs/actionpad-runtime.md`: document real Codex runtime env vars and smoke flow.

---

## Task 1: Add Runtime Codex Configuration

**Files:**
- Create: `runtime/codexConfig.ts`
- Create: `runtime/codexConfig.test.ts`
- Modify: `runtime/main.ts`
- Test: `runtime/codexConfig.test.ts`

- [ ] **Step 1: Write config tests**

Create `runtime/codexConfig.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parseRuntimeConfig } from "./codexConfig"

describe("codexConfig", () => {
  it("defaults to fake provider and conservative Codex settings", () => {
    const config = parseRuntimeConfig({}, "/repo/actionpad")

    expect(config).toEqual({
      provider: "fake",
      port: 43217,
      workspace: "/repo/actionpad",
      codex: {
        model: undefined,
        reasoning: undefined,
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
    })
  })

  it("parses explicit Codex runtime configuration", () => {
    const config = parseRuntimeConfig(
      {
        ACTIONPAD_PROVIDER: "codex",
        ACTIONPAD_RUNTIME_PORT: "54321",
        ACTIONPAD_WORKSPACE: "/tmp/project",
        ACTIONPAD_CODEX_MODEL: "gpt-5.3-codex",
        ACTIONPAD_CODEX_REASONING: "medium",
        ACTIONPAD_CODEX_SANDBOX: "read-only",
        ACTIONPAD_CODEX_APPROVAL: "never",
        ACTIONPAD_CODEX_NETWORK: "true",
        ACTIONPAD_CODEX_WEB_SEARCH: "live",
      },
      "/repo/actionpad",
    )

    expect(config.provider).toBe("codex")
    expect(config.port).toBe(54321)
    expect(config.workspace).toBe("/tmp/project")
    expect(config.codex).toEqual({
      model: "gpt-5.3-codex",
      reasoning: "medium",
      sandbox: "read-only",
      approval: "never",
      network: true,
      webSearch: "live",
    })
  })

  it("rejects invalid provider and safety settings", () => {
    expect(() => parseRuntimeConfig({ ACTIONPAD_PROVIDER: "remote" }, "/repo")).toThrow(
      "ACTIONPAD_PROVIDER must be fake or codex.",
    )
    expect(() => parseRuntimeConfig({ ACTIONPAD_CODEX_SANDBOX: "root" }, "/repo")).toThrow(
      "ACTIONPAD_CODEX_SANDBOX must be read-only, workspace-write, or danger-full-access.",
    )
    expect(() => parseRuntimeConfig({ ACTIONPAD_CODEX_APPROVAL: "always" }, "/repo")).toThrow(
      "ACTIONPAD_CODEX_APPROVAL must be never, on-request, on-failure, or untrusted.",
    )
  })
})
```

- [ ] **Step 2: Run failing config tests**

Run:

```bash
npm run runtime:test -- runtime/codexConfig.test.ts
```

Expected: FAIL because `runtime/codexConfig.ts` does not exist.

- [ ] **Step 3: Implement config parsing**

Create `runtime/codexConfig.ts`:

```ts
export type RuntimeProviderName = "fake" | "codex"
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access"
export type CodexApprovalMode = "never" | "on-request" | "on-failure" | "untrusted"
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"
export type CodexWebSearchMode = "disabled" | "cached" | "live"

export type RuntimeConfig = {
  provider: RuntimeProviderName
  port: number
  workspace: string
  codex: {
    model?: string
    reasoning?: CodexReasoningEffort
    sandbox: CodexSandboxMode
    approval: CodexApprovalMode
    network: boolean
    webSearch: CodexWebSearchMode
  }
}

const SANDBOXES = new Set<CodexSandboxMode>([
  "read-only",
  "workspace-write",
  "danger-full-access",
])
const APPROVALS = new Set<CodexApprovalMode>([
  "never",
  "on-request",
  "on-failure",
  "untrusted",
])
const REASONING = new Set<CodexReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"])
const WEB_SEARCH = new Set<CodexWebSearchMode>(["disabled", "cached", "live"])

function readEnum<T extends string>(
  value: string | undefined,
  allowed: Set<T>,
  fallback: T | undefined,
  message: string,
): T | undefined {
  if (value === undefined || value === "") return fallback
  if (allowed.has(value as T)) return value as T
  throw new Error(message)
}

function readBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1"
}

export function parseRuntimeConfig(
  env: Record<string, string | undefined>,
  defaultWorkspace: string,
): RuntimeConfig {
  const provider = env.ACTIONPAD_PROVIDER ?? "fake"
  if (provider !== "fake" && provider !== "codex") {
    throw new Error("ACTIONPAD_PROVIDER must be fake or codex.")
  }

  const port = Number(env.ACTIONPAD_RUNTIME_PORT ?? "43217")
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("ACTIONPAD_RUNTIME_PORT must be a positive integer.")
  }

  return {
    provider,
    port,
    workspace: env.ACTIONPAD_WORKSPACE || defaultWorkspace,
    codex: {
      model: env.ACTIONPAD_CODEX_MODEL || undefined,
      reasoning: readEnum(
        env.ACTIONPAD_CODEX_REASONING,
        REASONING,
        undefined,
        "ACTIONPAD_CODEX_REASONING must be minimal, low, medium, high, or xhigh.",
      ),
      sandbox: readEnum(
        env.ACTIONPAD_CODEX_SANDBOX,
        SANDBOXES,
        "workspace-write",
        "ACTIONPAD_CODEX_SANDBOX must be read-only, workspace-write, or danger-full-access.",
      )!,
      approval: readEnum(
        env.ACTIONPAD_CODEX_APPROVAL,
        APPROVALS,
        "on-request",
        "ACTIONPAD_CODEX_APPROVAL must be never, on-request, on-failure, or untrusted.",
      )!,
      network: readBoolean(env.ACTIONPAD_CODEX_NETWORK),
      webSearch: readEnum(
        env.ACTIONPAD_CODEX_WEB_SEARCH,
        WEB_SEARCH,
        "disabled",
        "ACTIONPAD_CODEX_WEB_SEARCH must be disabled, cached, or live.",
      )!,
    },
  }
}
```

- [ ] **Step 4: Wire config into runtime main**

Modify `runtime/main.ts`:

```ts
import { createCodexProvider } from "./codexProvider"
import { parseRuntimeConfig } from "./codexConfig"
import { createFakeProvider } from "./fakeProvider"
import { startRuntimeServer } from "./server"

const config = parseRuntimeConfig(process.env, process.cwd())
const provider =
  config.provider === "codex"
    ? createCodexProvider({ config: config.codex, workspace: config.workspace })
    : createFakeProvider()
const handle = await startRuntimeServer({ port: config.port, providers: [provider] })

console.log(`Actionpad runtime listening at ${handle.url}`)
console.log(`Actionpad provider: ${config.provider}`)
console.log(`Actionpad workspace: ${config.workspace}`)
console.log(
  `Actionpad Codex safety: sandbox=${config.codex.sandbox} approval=${config.codex.approval} network=${config.codex.network} webSearch=${config.codex.webSearch}`,
)

async function shutdown(): Promise<void> {
  await handle.close()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
```

Temporarily update `createCodexProvider` signature in `runtime/codexProvider.ts` so this compiles until Task 4 fills it in:

```ts
export function createCodexProvider(_options?: {
  config?: unknown
  workspace?: string
}): AgentProvider {
  const codex = new Codex()
  // keep existing body for now
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run runtime:test -- runtime/codexConfig.test.ts
npm run lint
```

Expected: both pass.

Commit:

```bash
git add runtime/codexConfig.ts runtime/codexConfig.test.ts runtime/main.ts runtime/codexProvider.ts
git commit -m "feat: add actionpad codex runtime config"
```

---

## Task 2: Harden Outline Output Parsing For Executing Bullet

**Files:**
- Modify: `runtime/outlineOutput.ts`
- Modify: `runtime/outlineOutput.test.ts`
- Test: `runtime/outlineOutput.test.ts`

- [ ] **Step 1: Add parser tests**

Extend `runtime/outlineOutput.test.ts`:

```ts
it("rejects missing Actionpad output blocks", () => {
  expect(extractOutlinePatch("No patch here.", { expectedParentId: "research-products" })).toEqual({
    error: "No Actionpad outline output block found.",
  })
})

it("returns a validation error for invalid JSON", () => {
  const patch = extractOutlinePatch(
    `<actionpad-outline-output>{ broken json }</actionpad-outline-output>`,
    { expectedParentId: "research-products" },
  )

  expect(patch).toEqual({ error: "Outline output block is not valid JSON." })
})

it("rejects patches that target a different parent", () => {
  const patch = extractOutlinePatch(
    `<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "other-node", "bullets": [{ "text": "Wrong parent." }] }
</actionpad-outline-output>`,
    { expectedParentId: "research-products" },
  )

  expect(patch).toEqual({ error: "Outline output must target the executing bullet." })
})
```

Update existing valid tests to pass `{ expectedParentId: "research-products" }`.

- [ ] **Step 2: Run failing parser tests**

Run:

```bash
npm run runtime:test -- runtime/outlineOutput.test.ts
```

Expected: FAIL because `extractOutlinePatch` does not accept options.

- [ ] **Step 3: Implement expected-parent validation**

Modify `runtime/outlineOutput.ts`:

```ts
import type { OutlinePatch } from "../src/domain/runtimeProtocol"
import { validateOutlinePatch } from "../src/domain/runtimeProtocol"

type OutlinePatchResult = OutlinePatch | { error: string }
type ExtractOptions = { expectedParentId?: string }

const START = "<actionpad-outline-output>"
const END = "</actionpad-outline-output>"

export function extractOutlinePatch(
  text: string,
  options: ExtractOptions = {},
): OutlinePatchResult {
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
  const patch = parsed as OutlinePatch
  if (
    options.expectedParentId &&
    patch.type === "append-child-bullets" &&
    patch.parentId !== options.expectedParentId
  ) {
    return { error: "Outline output must target the executing bullet." }
  }

  return patch
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run runtime:test -- runtime/outlineOutput.test.ts
npm run lint
```

Expected: both pass.

Commit:

```bash
git add runtime/outlineOutput.ts runtime/outlineOutput.test.ts
git commit -m "feat: validate actionpad outline output parent"
```

---

## Task 3: Add Codex SDK Event Mapper

**Files:**
- Create: `runtime/codexEventMapper.ts`
- Create: `runtime/codexEventMapper.test.ts`
- Modify: `src/domain/runtimeProtocol.ts` if a small neutral event field is needed.
- Test: `runtime/codexEventMapper.test.ts`

- [ ] **Step 1: Write mapper tests**

Create `runtime/codexEventMapper.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { ThreadEvent } from "@openai/codex-sdk"
import { createCodexEventMapper } from "./codexEventMapper"

describe("codexEventMapper", () => {
  it("maps thread start and assistant messages", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    const started = mapper.map({
      type: "thread.started",
      thread_id: "codex-thread-1",
    } satisfies ThreadEvent)
    const messageStarted = mapper.map({
      type: "item.started",
      item: { id: "msg-1", type: "agent_message", text: "" },
    } satisfies ThreadEvent)
    const messageCompleted = mapper.map({
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "Final answer." },
    } satisfies ThreadEvent)

    expect(started).toEqual([
      {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        providerThreadId: "codex-thread-1",
        createdAt: 100,
      },
    ])
    expect(messageStarted).toEqual([
      { type: "assistant-message-started", runId: "run-1", messageId: "msg-1", createdAt: 100 },
    ])
    expect(messageCompleted).toEqual([
      {
        type: "assistant-delta",
        runId: "run-1",
        messageId: "msg-1",
        delta: "Final answer.",
        createdAt: 100,
      },
      {
        type: "assistant-message-completed",
        runId: "run-1",
        messageId: "msg-1",
        content: "Final answer.",
        createdAt: 100,
      },
    ])
    expect(mapper.finalAssistantText()).toBe("Final answer.")
    expect(mapper.providerThreadId()).toBe("codex-thread-1")
  })

  it("maps command execution and file changes into tool timeline events", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    expect(
      mapper.map({
        type: "item.started",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "npm test",
          aggregated_output: "",
          status: "in_progress",
        },
      } satisfies ThreadEvent),
    ).toEqual([
      {
        type: "tool-started",
        runId: "run-1",
        toolCallId: "cmd-1",
        name: "npm test",
        createdAt: 100,
      },
    ])

    expect(
      mapper.map({
        type: "item.completed",
        item: {
          id: "file-1",
          type: "file_change",
          changes: [{ path: "src/App.tsx", kind: "update" }],
          status: "completed",
        },
      } satisfies ThreadEvent),
    ).toEqual([
      {
        type: "tool-completed",
        runId: "run-1",
        toolCallId: "file-1",
        name: "File changes",
        output: "update src/App.tsx",
        createdAt: 100,
      },
    ])
  })

  it("maps turn failures into run-failed", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    expect(
      mapper.map({
        type: "turn.failed",
        error: { message: "Codex auth failed." },
      } satisfies ThreadEvent),
    ).toEqual([
      { type: "run-failed", runId: "run-1", error: "Codex auth failed.", createdAt: 100 },
    ])
  })
})
```

- [ ] **Step 2: Run failing mapper tests**

Run:

```bash
npm run runtime:test -- runtime/codexEventMapper.test.ts
```

Expected: FAIL because `runtime/codexEventMapper.ts` does not exist.

- [ ] **Step 3: Implement mapper**

Create `runtime/codexEventMapper.ts`:

```ts
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk"
import type { AgentRuntimeEvent, RunId } from "../src/domain/runtimeProtocol"
import type { ThreadId } from "../src/domain/types"

type MapperOptions = {
  runId: RunId
  threadId: ThreadId
  nodeId: string
  startedAt?: number
  now?: () => number
}

type CodexEventMapper = {
  map(event: ThreadEvent): AgentRuntimeEvent[]
  finalAssistantText(): string
  providerThreadId(): string | null
}

function summarizeFileChanges(item: Extract<ThreadItem, { type: "file_change" }>): string {
  return item.changes.map((change) => `${change.kind} ${change.path}`).join("\n")
}

function summarizeMcpTool(item: Extract<ThreadItem, { type: "mcp_tool_call" }>): string {
  if (item.error) return item.error.message
  if (!item.result) return ""
  return item.result.content.map((block) => ("text" in block ? block.text : block.type)).join("\n")
}

export function createCodexEventMapper(options: MapperOptions): CodexEventMapper {
  const now = options.now ?? (() => options.startedAt ?? Date.now())
  const completedAssistantText = new Map<string, string>()
  const startedMessages = new Set<string>()
  let providerThreadId: string | null = null
  let emittedRunStarted = false

  function ensureRunStarted(createdAt: number): AgentRuntimeEvent[] {
    if (emittedRunStarted) return []
    emittedRunStarted = true
    return [
      {
        type: "run-started",
        runId: options.runId,
        threadId: options.threadId,
        nodeId: options.nodeId,
        provider: "codex",
        providerThreadId,
        createdAt,
      },
    ]
  }

  function mapItem(eventType: ThreadEvent["type"], item: ThreadItem): AgentRuntimeEvent[] {
    const createdAt = now()
    const prefix = ensureRunStarted(createdAt)
    switch (item.type) {
      case "agent_message": {
        const events: AgentRuntimeEvent[] = []
        if (!startedMessages.has(item.id)) {
          startedMessages.add(item.id)
          events.push({
            type: "assistant-message-started",
            runId: options.runId,
            messageId: item.id,
            createdAt,
          })
        }
        if (eventType === "item.completed") {
          const previous = completedAssistantText.get(item.id) ?? ""
          const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text
          completedAssistantText.set(item.id, item.text)
          if (delta) {
            events.push({
              type: "assistant-delta",
              runId: options.runId,
              messageId: item.id,
              delta,
              createdAt,
            })
          }
          events.push({
            type: "assistant-message-completed",
            runId: options.runId,
            messageId: item.id,
            content: item.text,
            createdAt,
          })
        }
        return [...prefix, ...events]
      }
      case "reasoning":
        if (eventType !== "item.completed" || !item.text.trim()) return prefix
        return [
          ...prefix,
          {
            type: "message-created",
            runId: options.runId,
            message: {
              id: item.id,
              role: "system",
              content: item.text,
              createdAt,
              status: "complete",
            },
            createdAt,
          },
        ]
      case "command_execution":
        if (eventType === "item.started") {
          return [
            ...prefix,
            {
              type: "tool-started",
              runId: options.runId,
              toolCallId: item.id,
              name: item.command,
              createdAt,
            },
          ]
        }
        if (eventType === "item.completed") {
          return [
            ...prefix,
            {
              type: "tool-completed",
              runId: options.runId,
              toolCallId: item.id,
              name: item.command,
              output: item.aggregated_output,
              createdAt,
            },
          ]
        }
        return prefix
      case "file_change":
        if (eventType !== "item.completed") return prefix
        return [
          ...prefix,
          {
            type: "tool-completed",
            runId: options.runId,
            toolCallId: item.id,
            name: "File changes",
            output: summarizeFileChanges(item),
            createdAt,
          },
        ]
      case "mcp_tool_call":
        if (eventType === "item.started") {
          return [
            ...prefix,
            {
              type: "tool-started",
              runId: options.runId,
              toolCallId: item.id,
              name: `${item.server}.${item.tool}`,
              createdAt,
            },
          ]
        }
        if (eventType === "item.completed") {
          return [
            ...prefix,
            {
              type: "tool-completed",
              runId: options.runId,
              toolCallId: item.id,
              name: `${item.server}.${item.tool}`,
              output: summarizeMcpTool(item),
              createdAt,
            },
          ]
        }
        return prefix
      case "web_search":
        if (eventType !== "item.started") return prefix
        return [
          ...prefix,
          {
            type: "tool-started",
            runId: options.runId,
            toolCallId: item.id,
            name: `Web search: ${item.query}`,
            createdAt,
          },
        ]
      case "error":
        return [
          ...prefix,
          { type: "run-failed", runId: options.runId, error: item.message, createdAt },
        ]
      default:
        return prefix
    }
  }

  return {
    map(event) {
      const createdAt = now()
      switch (event.type) {
        case "thread.started":
          providerThreadId = event.thread_id
          return ensureRunStarted(createdAt)
        case "item.started":
        case "item.updated":
        case "item.completed":
          return mapItem(event.type, event.item)
        case "turn.failed":
          return [
            ...ensureRunStarted(createdAt),
            { type: "run-failed", runId: options.runId, error: event.error.message, createdAt },
          ]
        case "error":
          return [
            ...ensureRunStarted(createdAt),
            { type: "run-failed", runId: options.runId, error: event.message, createdAt },
          ]
        case "turn.completed":
        case "turn.started":
          return ensureRunStarted(createdAt)
      }
    },
    finalAssistantText() {
      return Array.from(completedAssistantText.values()).at(-1) ?? ""
    },
    providerThreadId() {
      return providerThreadId
    },
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run runtime:test -- runtime/codexEventMapper.test.ts
npm run lint
```

Expected: both pass.

Commit:

```bash
git add runtime/codexEventMapper.ts runtime/codexEventMapper.test.ts
git commit -m "feat: map codex sdk events to actionpad events"
```

---

## Task 4: Refactor Codex Provider To Stream Real SDK Events

**Files:**
- Modify: `runtime/codexProvider.ts`
- Create: `runtime/codexProvider.test.ts`
- Modify: `runtime/provider.ts` only if the existing provider event union conflicts with `AgentRuntimeEvent`.
- Test: `runtime/codexProvider.test.ts`

- [ ] **Step 1: Write provider tests with fake Codex client**

Create `runtime/codexProvider.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import type { ThreadEvent } from "@openai/codex-sdk"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import { createCodexProvider, type CodexClientLike } from "./codexProvider"

const request: StartRunRequest = {
  provider: "codex",
  nodeId: "research-products",
  prompt: "Create two child bullets.",
  context: "Actionpad Prototype\nResearch\nCreate two child bullets.",
  outline: { rootIds: [], nodes: {}, focusedNodeId: "research-products" },
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

function fakeCodex(events: ThreadEvent[]): CodexClientLike {
  return {
    startThread: vi.fn(() => ({
      id: null,
      runStreamed: vi.fn(async () => ({
        async *events() {
          for (const event of events) yield event
        },
      })),
    })),
    resumeThread: vi.fn(),
  }
}

describe("codexProvider", () => {
  it("streams Codex events and emits a validated outline patch", async () => {
    const finalText = `Done.
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "First child." }] }
</actionpad-outline-output>`
    const provider = createCodexProvider({
      codex: fakeCodex([
        { type: "thread.started", thread_id: "codex-thread-1" },
        { type: "item.started", item: { id: "msg-1", type: "agent_message", text: "" } },
        { type: "item.completed", item: { id: "msg-1", type: "agent_message", text: finalText } },
        {
          type: "item.completed",
          item: {
            id: "file-1",
            type: "file_change",
            changes: [{ path: "README.md", kind: "update" }],
            status: "completed",
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      ]),
      workspace: "/repo/actionpad",
      config: {
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run-started",
        providerThreadId: "codex-thread-1",
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-completed",
        name: "File changes",
        output: "update README.md",
      }),
    )
    expect(events).toContainEqual({
      type: "outline-patch",
      runId: expect.any(String),
      patch: {
        type: "append-child-bullets",
        parentId: "research-products",
        bullets: [{ text: "First child." }],
      },
      createdAt: 100,
    })
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "run-completed", createdAt: 100 }),
    )
  })

  it("emits run-failed when outline output is missing or targets the wrong parent", async () => {
    const provider = createCodexProvider({
      codex: fakeCodex([
        { type: "thread.started", thread_id: "codex-thread-1" },
        {
          type: "item.completed",
          item: {
            id: "msg-1",
            type: "agent_message",
            text: `<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "wrong-parent", "bullets": [{ "text": "Nope." }] }
</actionpad-outline-output>`,
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      ]),
      workspace: "/repo/actionpad",
      config: {
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events).toContainEqual({
      type: "run-failed",
      runId: expect.any(String),
      error: "Outline output must target the executing bullet.",
      createdAt: 100,
    })
    expect(events.some((event) => event.type === "run-completed")).toBe(false)
  })
})
```

- [ ] **Step 2: Run failing provider tests**

Run:

```bash
npm run runtime:test -- runtime/codexProvider.test.ts
```

Expected: FAIL because `createCodexProvider` is not injectable and still uses `run(...)`.

- [ ] **Step 3: Implement streaming provider**

Replace `runtime/codexProvider.ts` with:

```ts
import { Codex } from "@openai/codex-sdk"
import type { Thread, ThreadEvent, ThreadOptions } from "@openai/codex-sdk"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider, AgentProviderEvent, AgentThreadSnapshot } from "./provider"
import { createCodexEventMapper } from "./codexEventMapper"
import type { RuntimeConfig } from "./codexConfig"
import { extractOutlinePatch } from "./outlineOutput"

export type CodexClientLike = {
  startThread(options?: ThreadOptions): Pick<Thread, "id" | "runStreamed">
  resumeThread(id: string, options?: ThreadOptions): Pick<Thread, "id" | "runStreamed">
}

type CodexProviderOptions = {
  codex?: CodexClientLike
  workspace?: string
  config?: Partial<RuntimeConfig["codex"]>
  now?: () => number
}

function buildActionpadPrompt(input: StartRunRequest): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    "The patch must append child bullets under the executing bullet.",
    `Executing bullet id: ${input.nodeId}`,
    `Executing bullet text: ${input.prompt}`,
    "Context:",
    input.context,
  ].join("\n\n")
}

function toThreadOptions(options: CodexProviderOptions): ThreadOptions {
  return {
    workingDirectory: options.workspace ?? process.cwd(),
    skipGitRepoCheck: true,
    model: options.config?.model,
    sandboxMode: options.config?.sandbox,
    approvalPolicy: options.config?.approval,
    modelReasoningEffort: options.config?.reasoning,
    networkAccessEnabled: options.config?.network,
    webSearchMode: options.config?.webSearch,
  }
}

export function createCodexProvider(options: CodexProviderOptions = {}): AgentProvider {
  const codex = options.codex ?? new Codex()
  const now = options.now ?? Date.now
  const activeControllers = new Map<string, AbortController>()
  const threads = new Map<string, AgentThreadSnapshot>()

  return {
    id: "codex",

    async *startRun(input: StartRunRequest): AsyncIterable<AgentProviderEvent> {
      const startedAt = now()
      const runId = `codex-run-${startedAt}`
      const threadId = `codex-thread-${startedAt}`
      const controller = new AbortController()
      const mapper = createCodexEventMapper({
        runId,
        threadId,
        nodeId: input.nodeId,
        startedAt,
        now,
      })
      activeControllers.set(runId, controller)

      try {
        const thread = codex.startThread(toThreadOptions(options))
        const streamed = await thread.runStreamed(buildActionpadPrompt(input), {
          signal: controller.signal,
        })

        for await (const event of streamed.events as AsyncGenerator<ThreadEvent>) {
          for (const mapped of mapper.map(event)) {
            yield mapped
          }
        }

        const providerThreadId = mapper.providerThreadId()
        threads.set(threadId, {
          id: threadId,
          provider: "codex",
          providerThreadId,
          nodeId: input.nodeId,
          messages: [],
          runs: [runId],
          providerMetadata: {},
        })

        const patch = extractOutlinePatch(mapper.finalAssistantText(), {
          expectedParentId: input.nodeId,
        })
        if ("error" in patch) {
          yield { type: "run-failed", runId, error: patch.error, createdAt: now() }
          return
        }

        yield { type: "outline-patch", runId, patch, createdAt: now() }
        yield { type: "run-completed", runId, createdAt: now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Codex runtime failed."
        yield { type: "run-failed", runId, error: message, createdAt: now() }
      } finally {
        activeControllers.delete(runId)
      }
    },

    async *sendMessage() {
      throw new Error("Codex follow-up messages are not implemented in Phase 2.")
    },

    cancelRun(runId) {
      activeControllers.get(runId)?.abort()
    },

    getThread(threadId) {
      return threads.get(threadId) ?? null
    },
  }
}
```

If TypeScript reports the fake test thread type is missing SDK-private fields, keep `CodexClientLike` local and avoid `Pick<Thread, ...>`:

```ts
type CodexThreadLike = {
  id: string | null
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{
    events: AsyncGenerator<ThreadEvent>
  }>
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run runtime:test -- runtime/codexProvider.test.ts runtime/codexEventMapper.test.ts runtime/outlineOutput.test.ts
npm run lint
```

Expected: both pass.

Commit:

```bash
git add runtime/codexProvider.ts runtime/codexProvider.test.ts runtime/provider.ts
git commit -m "feat: stream real codex runtime events"
```

---

## Task 5: Surface Approval And Tool Events Cleanly In The Side Panel

**Files:**
- Modify: `src/components/ChatThreadView.tsx`
- Modify: `src/components/SidePanel.test.tsx`
- Modify: `src/styles.css`
- Test: `src/components/SidePanel.test.tsx`

- [ ] **Step 1: Add UI event rendering test**

Add to `src/components/SidePanel.test.tsx`:

```ts
test("renders runtime tool and approval events", async () => {
  const user = userEvent.setup()
  render(<App />)

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "tool-started",
    runId,
    toolCallId: "tool-1",
    name: "npm test",
    createdAt: 110,
  })
  await emitRuntimeEvent({
    type: "tool-completed",
    runId,
    toolCallId: "tool-1",
    name: "npm test",
    output: "passed",
    createdAt: 111,
  })
  await emitRuntimeEvent({
    type: "approval-requested",
    runId,
    approval: {
      id: "approval-1",
      runId,
      title: "Allow command",
      description: "Codex requested approval.",
      createdAt: 112,
    },
    createdAt: 112,
  })

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByText("Tool started")).toBeInTheDocument()
  expect(within(panel).getByText("Tool completed")).toBeInTheDocument()
  expect(within(panel).getByText("Approval requested")).toBeInTheDocument()
  expect(within(panel).getByText("approval-1")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run failing UI test**

Run:

```bash
npm test -- src/components/SidePanel.test.tsx
```

Expected: FAIL because approval events are not rendered.

- [ ] **Step 3: Render approval events**

Modify `src/components/ChatThreadView.tsx` event map:

```tsx
if (event.type === "approval-requested") {
  return (
    <article key={`${event.createdAt}-${index}`} className="event-card is-warning">
      <strong>Approval requested</strong>
      <p>{event.approvalId}</p>
    </article>
  )
}
```

Add CSS to `src/styles.css`:

```css
.event-card.is-warning {
  border-color: #ead39a;
  background: #fff9e8;
  color: #624a12;
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- src/components/SidePanel.test.tsx
npm run lint
```

Expected: both pass.

Commit:

```bash
git add src/components/ChatThreadView.tsx src/components/SidePanel.test.tsx src/styles.css
git commit -m "feat: show codex approval events"
```

---

## Task 6: Runtime Integration Verification And Docs

**Files:**
- Modify: `docs/actionpad-runtime.md`
- Test: automated verification plus optional manual Codex smoke

- [ ] **Step 1: Update runtime docs**

Modify `docs/actionpad-runtime.md` to include:

````md
## Real Codex Provider

Start the runtime with local Codex SDK execution:

```bash
ACTIONPAD_PROVIDER=codex npm run runtime:dev
```

Useful configuration:

```bash
ACTIONPAD_WORKSPACE=/path/to/project
ACTIONPAD_CODEX_SANDBOX=workspace-write
ACTIONPAD_CODEX_APPROVAL=on-request
ACTIONPAD_CODEX_NETWORK=false
ACTIONPAD_CODEX_WEB_SEARCH=disabled
ACTIONPAD_CODEX_MODEL=gpt-5.3-codex
ACTIONPAD_CODEX_REASONING=medium
```

The runtime uses local Codex authentication. Automated tests use mocked Codex clients and do not require credentials.

For a smoke test, create or focus a bullet such as:

```text
Create two child bullets about why Actionpad should stay outline-first.
```

Press `Cmd+Enter`. A successful run should stream assistant output and append child bullets if Codex emits a valid Actionpad output block.
````

- [ ] **Step 2: Run automated verification**

Run:

```bash
npm run runtime:test
npm test
npm run lint
npm run build
```

Expected:

- `npm run runtime:test`: PASS
- `npm test`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS

If localhost binding fails in sandbox, rerun the test command with permission to bind `127.0.0.1`.

- [ ] **Step 3: Manual fake-provider browser QA**

Run:

```bash
ACTIONPAD_PROVIDER=fake npm run runtime:dev
npm run dev
```

In the browser:

1. Focus `Find adjacent products and patterns`.
2. Press `Cmd+Enter`.
3. Confirm side panel opens.
4. Confirm assistant output appears.
5. Confirm `Outline output` appears.
6. Confirm three child bullets are appended.

- [ ] **Step 4: Manual Codex smoke test**

Run only when local Codex auth is configured:

```bash
ACTIONPAD_PROVIDER=codex npm run runtime:dev
npm run dev
```

In the browser:

1. Create or focus a bullet with this text:

```text
Create two child bullets about why Actionpad should stay outline-first.
```

2. Press `Cmd+Enter`.
3. Confirm the side panel receives real Codex assistant output.
4. Confirm tool/file events appear if Codex uses tools.
5. Confirm valid outline output appends child bullets.
6. If Codex emits invalid output, confirm the run fails visibly and no malformed bullets are added.

- [ ] **Step 5: Commit docs**

Run:

```bash
git status --short
```

Commit:

```bash
git add docs/actionpad-runtime.md
git commit -m "docs: document real codex runtime"
```

---

## Self-Review

Spec coverage:

- Local Codex SDK in current workspace: Tasks 1 and 4.
- Streamed Codex SDK events: Tasks 3 and 4.
- Provider thread identity: Tasks 3 and 4.
- Tool/file/reasoning/failure mapping: Task 3, with UI event coverage in Task 5.
- Validated outline output under executing bullet: Task 2 and Task 4.
- Fake provider retained: Task 1 and verification in Task 6.
- Explicit safety config: Task 1 and docs in Task 6.
- Tests without real Codex credentials: Tasks 3 and 4 use mocked SDK streams.

Placeholder scan:

- No placeholder markers.
- All tasks list exact files and verification commands.
- Real Codex manual smoke is explicitly optional and credentials-dependent.

Type consistency:

- Runtime events use existing `AgentRuntimeEvent` shapes.
- Codex mapper tests use SDK `ThreadEvent` and emit provider-neutral `AgentProviderEvent`.
- Outline parser uses the existing `OutlinePatch` and `validateOutlinePatch` contract.
