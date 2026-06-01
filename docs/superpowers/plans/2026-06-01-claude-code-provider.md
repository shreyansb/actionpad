# Claude Code Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code as a second Actionpad runtime provider/backend alongside the existing Codex provider.

**Architecture:** Keep Actionpad's provider contract as the boundary: the browser sends provider-neutral run/message requests, the runtime chooses a provider, and each provider maps backend-specific streams into `AgentRuntimeEvent`s. Implement Claude Code through a small CLI runner first, because the local `claude` executable exposes a verified non-interactive streaming JSON interface; keep the runner isolated so it can later be replaced by a direct TypeScript SDK wrapper if package docs/imports become available.

**Tech Stack:** React/Vite frontend, TypeScript runtime, Node `child_process`, Claude Code CLI 2.1.152, existing Actionpad runtime websocket protocol, Vitest.

---

## Research Summary

- Current Actionpad provider contract is `runtime/provider.ts`: `startRun`, `sendMessage`, `cancelRun`, and `getThread`.
- Codex provider implementation is concentrated in `runtime/codexProvider.ts`, with Codex stream mapping in `runtime/codexEventMapper.ts`.
- Initial runs are still hardcoded to `provider: "codex"` in `src/store/OutlineStore.tsx`; follow-ups correctly reuse `thread.provider`.
- Runtime configuration currently accepts only `ACTIONPAD_PROVIDER=fake|codex` in `runtime/codexConfig.ts`.
- The installed local Claude Code binary is `/Users/shreyans/.local/bin/claude`, version `2.1.152 (Claude Code)`.
- `claude --help` confirms the CLI supports:
  - `-p, --print` for non-interactive output.
  - `--output-format stream-json` for realtime JSON output.
  - `--include-partial-messages` for partial message chunks.
  - `--input-format stream-json` for realtime input.
  - `--resume <session-id>`, `--continue`, and `--session-id <uuid>` for session control.
  - `--model`, `--effort`, `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--add-dir`, `--system-prompt`, and `--append-system-prompt`.
- Claude local session files exist under `~/.claude/projects/<encoded-cwd>/*.jsonl`; entries include `sessionId`, `type`, `uuid`, `timestamp`, and assistant/user message records. This supports storing Claude's `session_id` as Actionpad `providerThreadId`.
- Network research for `@anthropic-ai/claude-code` was blocked in this sandbox: `npm view @anthropic-ai/claude-code ...` failed with `ENOTFOUND registry.npmjs.org`. The implementation should not depend on unverified package import shapes.

## Target Behavior

- `ACTIONPAD_PROVIDER=claude npm run runtime:start` starts the runtime backed by Claude Code.
- Initial Cmd-Enter runs use the default provider configured in the browser build/runtime environment.
- Follow-up messages keep using the provider stored on the Actionpad thread.
- Claude run events show in the same chat panel timeline as Codex runs: user message, assistant text, tool calls when available, outline patch, completion/failure.
- The stop button cancels the currently active Claude run by aborting/killing the underlying CLI process.
- Backups keep `provider: "claude"` and `providerThreadId` while still omitting bulky chat/event content as the current slim backup does.

## File Map

- Create `runtime/actionpadPrompt.ts`: shared prompt builder currently embedded in `runtime/codexProvider.ts`.
- Create `runtime/actionpadPrompt.test.ts`: regression coverage for initial/follow-up prompt mode and outline patch instructions.
- Modify `runtime/codexProvider.ts`: import the shared prompt builder; no behavior change.
- Modify `src/domain/runtimeProtocol.ts`: add `"claude"` to `AgentProviderId`.
- Modify `runtime/codexConfig.ts`: add `claude` to provider config. Keep filename for now to avoid a broad rename; optionally rename in a later cleanup.
- Modify `runtime/codexConfig.test.ts`: cover `ACTIONPAD_PROVIDER=claude` and Claude-specific env parsing.
- Create `runtime/claudeCliRunner.ts`: spawn Claude Code CLI, stream JSON lines, support abort.
- Create `runtime/claudeCliRunner.test.ts`: unit-test argument construction and JSONL parsing without launching Claude.
- Create `runtime/claudeEventMapper.ts`: map Claude stream JSON events into Actionpad runtime events and collect final assistant text.
- Create `runtime/claudeEventMapper.test.ts`: pure mapping coverage for system init, assistant text, tool use/result, and error result.
- Create `runtime/claudeProvider.ts`: provider implementation matching `AgentProvider`.
- Create `runtime/claudeProvider.test.ts`: provider-level tests with fake runner events and cancellation.
- Modify `runtime/main.ts`: create the selected provider and log Claude config when selected.
- Modify `src/runtimeClient/runtimeClient.ts`: expose a browser-side default provider helper.
- Modify `src/store/OutlineStore.tsx`: use the default provider for first runs; keep follow-ups provider-sticky.
- Modify `src/store/outlineReducer.ts`: remove remaining Codex-only defaults where local failure state should use the attempted provider.
- Modify relevant tests under `src/store`, `src/runtimeClient`, and `runtime/server.test.ts`.
- Modify `docs/actionpad-runtime.md`: document how to run Codex vs Claude providers.

---

## Task 1: Extract the Shared Actionpad Prompt Builder

**Files:**
- Create: `runtime/actionpadPrompt.ts`
- Create: `runtime/actionpadPrompt.test.ts`
- Modify: `runtime/codexProvider.ts`

- [ ] **Step 1: Write the failing prompt-builder tests**

Create `runtime/actionpadPrompt.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"
import { buildActionpadPrompt } from "./actionpadPrompt"

const baseRunRequest: StartRunRequest = {
  provider: "codex",
  nodeId: "node-1",
  prompt: "Summarize this bullet.",
  context: "Parent\nFocused bullet",
  outline: {
    rootIds: ["node-1"],
    focusedNodeId: "node-1",
    nodes: {
      "node-1": {
        id: "node-1",
        parentId: null,
        children: [],
        text: "Summarize this bullet.",
        collapsed: false,
        runStatus: "idle",
        metadata: {},
      },
    },
  },
}

describe("buildActionpadPrompt", () => {
  it("builds initial run instructions with outline patch requirements", () => {
    const prompt = buildActionpadPrompt(baseRunRequest, "initial")

    expect(prompt).toContain("You are running inside Actionpad")
    expect(prompt).toContain("At the end, return exactly one outline patch")
    expect(prompt).toContain('"outcome" field')
    expect(prompt).toContain("For a new execution, usually append child bullets")
    expect(prompt).toContain("Executing bullet id: node-1")
    expect(prompt).toContain('"focusedNodeId": "node-1"')
  })

  it("builds follow-up instructions for existing outline ids", () => {
    const request: SendMessageRequest = {
      ...baseRunRequest,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      prompt: "Make it shorter.",
    }

    const prompt = buildActionpadPrompt(request, "follow-up")

    expect(prompt).toContain("For a follow-up, modify the existing outline as requested")
    expect(prompt).toContain("Executing bullet text: Make it shorter.")
  })
})
```

- [ ] **Step 2: Run the prompt-builder test and verify it fails**

Run:

```bash
npx vitest run --environment node runtime/actionpadPrompt.test.ts
```

Expected: FAIL because `runtime/actionpadPrompt.ts` does not exist.

- [ ] **Step 3: Create the shared prompt builder**

Create `runtime/actionpadPrompt.ts`:

```ts
import type { SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"

export type ActionpadPromptMode = "initial" | "follow-up"

export function buildActionpadPrompt(
  input: StartRunRequest | SendMessageRequest,
  mode: ActionpadPromptMode,
): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise and useful.",
    "When adding bullets, add only a few top-level bullets. Prefer sub-bullets for supporting detail instead of long flat lists.",
    "If the user asks for changes to previous output, edit or delete the relevant bullets instead of only appending new ones.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    'Include an "outcome" field in that patch JSON: "succeeded" when the task is fully handled, "incomplete" when you need a user answer or more information, and "failed" when you attempted the task but could not complete it.',
    "Supported patch shapes:",
    '{ "type": "append-child-bullets", "outcome": "succeeded", "parentId": "bullet-id", "bullets": [{ "text": "Short bullet", "children": [{ "text": "Optional sub-bullet" }] }] }',
    '{ "type": "update-bullet-text", "outcome": "succeeded", "nodeId": "bullet-id", "text": "Replacement text" }',
    '{ "type": "delete-bullets", "outcome": "succeeded", "nodeIds": ["bullet-id"] }',
    '{ "type": "batch", "outcome": "succeeded", "patches": [{ "type": "update-bullet-text", "nodeId": "bullet-id", "text": "Replacement text" }] }',
    mode === "initial"
      ? "For a new execution, usually append child bullets under the executing bullet."
      : "For a follow-up, modify the existing outline as requested using the current outline ids.",
    `Executing bullet id: ${input.nodeId}`,
    `Executing bullet text: ${input.prompt}`,
    "Current outline snapshot:",
    JSON.stringify(input.outline, null, 2),
    "Context:",
    input.context,
  ].join("\n\n")
}
```

- [ ] **Step 4: Import the shared builder in Codex provider**

In `runtime/codexProvider.ts`, delete the local `buildActionpadPrompt` function and add:

```ts
import { buildActionpadPrompt } from "./actionpadPrompt"
```

Keep both existing call sites unchanged:

```ts
thread.runStreamed(buildActionpadPrompt(input, "initial"), {
  signal: controller.signal,
})

thread.runStreamed(buildActionpadPrompt(input, "follow-up"), {
  signal: controller.signal,
})
```

- [ ] **Step 5: Verify Codex behavior still passes**

Run:

```bash
npx vitest run --environment node runtime/actionpadPrompt.test.ts runtime/codexProvider.test.ts runtime/codexEventMapper.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add runtime/actionpadPrompt.ts runtime/actionpadPrompt.test.ts runtime/codexProvider.ts
git commit -m "refactor: share actionpad provider prompt builder"
```

---

## Task 2: Add Provider Configuration for Claude

**Files:**
- Modify: `src/domain/runtimeProtocol.ts`
- Modify: `runtime/codexConfig.ts`
- Modify: `runtime/codexConfig.test.ts`

- [ ] **Step 1: Write failing config tests**

Add these cases to `runtime/codexConfig.test.ts`:

```ts
it("accepts Claude as the selected provider", () => {
  const config = parseRuntimeConfig(
    {
      ACTIONPAD_PROVIDER: "claude",
      ACTIONPAD_CLAUDE_MODEL: "sonnet",
      ACTIONPAD_CLAUDE_EFFORT: "high",
      ACTIONPAD_CLAUDE_PERMISSION_MODE: "acceptEdits",
      ACTIONPAD_CLAUDE_EXECUTABLE: "/usr/local/bin/claude",
    },
    "/repo/actionpad",
  )

  expect(config.provider).toBe("claude")
  expect(config.claude).toEqual({
    executable: "/usr/local/bin/claude",
    model: "sonnet",
    effort: "high",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: [],
  })
})

it("rejects unsupported Claude permission modes and effort levels", () => {
  expect(() =>
    parseRuntimeConfig({ ACTIONPAD_PROVIDER: "claude", ACTIONPAD_CLAUDE_EFFORT: "huge" }, "/repo"),
  ).toThrow("ACTIONPAD_CLAUDE_EFFORT must be low, medium, high, xhigh, or max.")

  expect(() =>
    parseRuntimeConfig(
      { ACTIONPAD_PROVIDER: "claude", ACTIONPAD_CLAUDE_PERMISSION_MODE: "root" },
      "/repo",
    ),
  ).toThrow(
    "ACTIONPAD_CLAUDE_PERMISSION_MODE must be acceptEdits, auto, bypassPermissions, default, dontAsk, or plan.",
  )
})

it("parses comma-separated Claude tool allow and deny lists", () => {
  const config = parseRuntimeConfig(
    {
      ACTIONPAD_PROVIDER: "claude",
      ACTIONPAD_CLAUDE_ALLOWED_TOOLS: "Read,Edit,Bash(git *)",
      ACTIONPAD_CLAUDE_DISALLOWED_TOOLS: "WebFetch,WebSearch",
    },
    "/repo",
  )

  expect(config.claude.allowedTools).toEqual(["Read", "Edit", "Bash(git *)"])
  expect(config.claude.disallowedTools).toEqual(["WebFetch", "WebSearch"])
})
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
npx vitest run --environment node runtime/codexConfig.test.ts
```

Expected: FAIL because `claude` is not an accepted provider and `config.claude` does not exist.

- [ ] **Step 3: Extend provider/runtime types**

In `src/domain/runtimeProtocol.ts`, change:

```ts
export type AgentProviderId = "codex"
```

to:

```ts
export type AgentProviderId = "codex" | "claude"
```

In `runtime/codexConfig.ts`, add:

```ts
export type RuntimeProviderName = "fake" | "codex" | "claude"
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max"
export type ClaudePermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan"
```

Update `RuntimeConfig`:

```ts
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
  claude: {
    executable: string
    model?: string
    effort?: ClaudeEffort
    permissionMode: ClaudePermissionMode
    allowedTools: string[]
    disallowedTools: string[]
  }
}
```

Add sets/helpers:

```ts
const PROVIDERS = new Set<RuntimeProviderName>(["fake", "codex", "claude"])
const CLAUDE_EFFORT = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"])
const CLAUDE_PERMISSION_MODES = new Set<ClaudePermissionMode>([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
])

function readStringList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}
```

Update provider parsing:

```ts
const provider = readEnum(
  env.ACTIONPAD_PROVIDER,
  PROVIDERS,
  "codex",
  "ACTIONPAD_PROVIDER must be fake, codex, or claude.",
)!
```

Add `claude` to the returned config:

```ts
claude: {
  executable: env.ACTIONPAD_CLAUDE_EXECUTABLE || "claude",
  model: env.ACTIONPAD_CLAUDE_MODEL || undefined,
  effort: readEnum(
    env.ACTIONPAD_CLAUDE_EFFORT,
    CLAUDE_EFFORT,
    undefined,
    "ACTIONPAD_CLAUDE_EFFORT must be low, medium, high, xhigh, or max.",
  ),
  permissionMode: readEnum(
    env.ACTIONPAD_CLAUDE_PERMISSION_MODE,
    CLAUDE_PERMISSION_MODES,
    "default",
    "ACTIONPAD_CLAUDE_PERMISSION_MODE must be acceptEdits, auto, bypassPermissions, default, dontAsk, or plan.",
  )!,
  allowedTools: readStringList(env.ACTIONPAD_CLAUDE_ALLOWED_TOOLS),
  disallowedTools: readStringList(env.ACTIONPAD_CLAUDE_DISALLOWED_TOOLS),
},
```

- [ ] **Step 4: Verify config tests pass**

Run:

```bash
npx vitest run --environment node runtime/codexConfig.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/runtimeProtocol.ts runtime/codexConfig.ts runtime/codexConfig.test.ts
git commit -m "feat: add claude provider configuration"
```

---

## Task 3: Add a Claude CLI Runner

**Files:**
- Create: `runtime/claudeCliRunner.ts`
- Create: `runtime/claudeCliRunner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `runtime/claudeCliRunner.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Readable, Writable } from "node:stream"
import { buildClaudeCliArgs, createClaudeCliRunner } from "./claudeCliRunner"

describe("buildClaudeCliArgs", () => {
  it("builds stream-json print args for a new run", () => {
    expect(
      buildClaudeCliArgs({
        model: "sonnet",
        effort: "high",
        permissionMode: "acceptEdits",
        allowedTools: ["Read", "Edit"],
        disallowedTools: ["WebFetch"],
        workspace: "/repo/actionpad",
      }),
    ).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      "/repo/actionpad",
      "--allowedTools",
      "Read,Edit",
      "--disallowedTools",
      "WebFetch",
    ])
  })

  it("adds resume when a provider thread id exists", () => {
    expect(
      buildClaudeCliArgs({
        permissionMode: "default",
        allowedTools: [],
        disallowedTools: [],
        workspace: "/repo/actionpad",
        resumeSessionId: "7e7c0f49-21d0-48c6-94f9-4edb40389141",
      }),
    ).toContain("--resume")
  })
})

describe("createClaudeCliRunner", () => {
  it("writes the prompt to stdin and yields parsed JSON lines", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable
      stdout: Readable
      stderr: Readable
      kill: ReturnType<typeof vi.fn>
    }
    const writes: string[] = []
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        writes.push(String(chunk))
        callback()
      },
    })
    child.stdout = Readable.from([
      '{"type":"system","subtype":"init","session_id":"session-1"}\n',
      '{"type":"result","subtype":"success","result":"done","session_id":"session-1"}\n',
    ])
    child.stderr = Readable.from([])
    child.kill = vi.fn()

    const spawn = vi.fn(() => child)
    const runner = createClaudeCliRunner({ spawn })

    const events = []
    for await (const event of runner.run({
      executable: "claude",
      prompt: "hello",
      workspace: "/repo/actionpad",
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: [],
    })) {
      events.push(event)
    }

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--print", "--output-format", "stream-json"]),
      expect.objectContaining({ cwd: "/repo/actionpad" }),
    )
    expect(writes.join("")).toBe("hello")
    expect(events).toEqual([
      { type: "system", subtype: "init", session_id: "session-1" },
      { type: "result", subtype: "success", result: "done", session_id: "session-1" },
    ])
  })
})
```

- [ ] **Step 2: Run runner tests and verify they fail**

Run:

```bash
npx vitest run --environment node runtime/claudeCliRunner.test.ts
```

Expected: FAIL because `runtime/claudeCliRunner.ts` does not exist.

- [ ] **Step 3: Implement the CLI runner**

Create `runtime/claudeCliRunner.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import type { RuntimeConfig } from "./codexConfig"

export type ClaudeStreamJsonEvent = Record<string, unknown> & { type?: string }

type Spawn = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcessByStdio<Writable, Readable, Readable>

export type ClaudeCliRunOptions = RuntimeConfig["claude"] & {
  prompt: string
  workspace: string
  resumeSessionId?: string | null
  signal?: AbortSignal
}

export function buildClaudeCliArgs(options: Omit<ClaudeCliRunOptions, "executable" | "prompt" | "signal">): string[] {
  const args = ["--print", "--output-format", "stream-json", "--include-partial-messages"]
  if (options.model) args.push("--model", options.model)
  if (options.effort) args.push("--effort", options.effort)
  args.push("--permission-mode", options.permissionMode)
  args.push("--add-dir", options.workspace)
  if (options.allowedTools.length > 0) args.push("--allowedTools", options.allowedTools.join(","))
  if (options.disallowedTools.length > 0) {
    args.push("--disallowedTools", options.disallowedTools.join(","))
  }
  if (options.resumeSessionId) args.push("--resume", options.resumeSessionId)
  return args
}

export function createClaudeCliRunner(options: { spawn?: Spawn } = {}) {
  const spawn = options.spawn ?? nodeSpawn

  return {
    async *run(runOptions: ClaudeCliRunOptions): AsyncIterable<ClaudeStreamJsonEvent> {
      const child = spawn(
        runOptions.executable,
        buildClaudeCliArgs(runOptions),
        { cwd: runOptions.workspace, stdio: ["pipe", "pipe", "pipe"] },
      )
      const stderrChunks: string[] = []
      const abort = () => child.kill("SIGTERM")
      runOptions.signal?.addEventListener("abort", abort, { once: true })

      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)))
      child.stdin.end(runOptions.prompt)

      try {
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
        for await (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          yield JSON.parse(trimmed) as ClaudeStreamJsonEvent
        }

        const exitCode = await new Promise<number | null>((resolve) => {
          child.once("close", (code) => resolve(code))
        })
        if (exitCode && exitCode !== 0 && !runOptions.signal?.aborted) {
          throw new Error(stderrChunks.join("").trim() || `Claude Code exited with ${exitCode}.`)
        }
      } finally {
        runOptions.signal?.removeEventListener("abort", abort)
      }
    },
  }
}
```

- [ ] **Step 4: Verify runner tests pass**

Run:

```bash
npx vitest run --environment node runtime/claudeCliRunner.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/claudeCliRunner.ts runtime/claudeCliRunner.test.ts
git commit -m "feat: add claude code cli runner"
```

---

## Task 4: Map Claude Stream JSON Events into Actionpad Events

**Files:**
- Create: `runtime/claudeEventMapper.ts`
- Create: `runtime/claudeEventMapper.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `runtime/claudeEventMapper.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { createClaudeEventMapper } from "./claudeEventMapper"

describe("createClaudeEventMapper", () => {
  it("emits run-started from Claude system init", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      prompt: "Do the work",
      context: "Context",
      now: () => 100,
    })

    expect(mapper.map({ type: "system", subtype: "init", session_id: "session-1" })).toEqual([
      {
        type: "run-started",
        runId: "claude-run-1",
        threadId: "claude-thread-1",
        nodeId: "node-1",
        provider: "claude",
        providerThreadId: "session-1",
        prompt: "Do the work",
        context: "Context",
        createdAt: 100,
      },
    ])
    expect(mapper.providerThreadId()).toBe("session-1")
  })

  it("maps assistant text blocks to assistant message events and final text", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    const events = mapper.map({
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      },
      session_id: "session-1",
    })

    expect(events).toContainEqual({
      type: "assistant-message-started",
      runId: "claude-run-1",
      messageId: "msg-1",
      createdAt: 100,
    })
    expect(events).toContainEqual({
      type: "assistant-delta",
      runId: "claude-run-1",
      messageId: "msg-1",
      delta: "Done.",
      createdAt: 100,
    })
    expect(events).toContainEqual({
      type: "assistant-message-completed",
      runId: "claude-run-1",
      messageId: "msg-1",
      content: "Done.",
      createdAt: 100,
    })
    expect(mapper.finalAssistantText()).toBe("Done.")
  })

  it("maps tool_use and tool_result content", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    expect(
      mapper.map({
        type: "assistant",
        message: {
          id: "msg-1",
          type: "message",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "git status" } }],
        },
      }),
    ).toContainEqual({
      type: "tool-started",
      runId: "claude-run-1",
      toolCallId: "tool-1",
      name: "Bash",
      createdAt: 100,
    })

    expect(
      mapper.map({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "clean" }],
        },
      }),
    ).toContainEqual({
      type: "tool-completed",
      runId: "claude-run-1",
      toolCallId: "tool-1",
      name: "Bash",
      output: "clean",
      createdAt: 100,
    })
  })

  it("maps error results to run-failed", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    expect(
      mapper.map({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        error: "Claude failed",
      }),
    ).toContainEqual({
      type: "run-failed",
      runId: "claude-run-1",
      error: "Claude failed",
      createdAt: 100,
    })
  })
})
```

- [ ] **Step 2: Run mapper tests and verify they fail**

Run:

```bash
npx vitest run --environment node runtime/claudeEventMapper.test.ts
```

Expected: FAIL because `runtime/claudeEventMapper.ts` does not exist.

- [ ] **Step 3: Implement the mapper**

Create `runtime/claudeEventMapper.ts`:

```ts
import type { AgentRuntimeEvent, RunId } from "../src/domain/runtimeProtocol"
import type { ThreadId } from "../src/domain/types"
import type { ClaudeStreamJsonEvent } from "./claudeCliRunner"

type MapperOptions = {
  runId: RunId
  threadId: ThreadId
  nodeId: string
  prompt?: string
  context?: string
  providerThreadId?: string | null
  now?: () => number
}

type ClaudeContentBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function contentBlocks(event: ClaudeStreamJsonEvent): ClaudeContentBlock[] {
  const message = isRecord(event.message) ? event.message : null
  const content = message?.content
  return Array.isArray(content) ? (content as ClaudeContentBlock[]) : []
}

function messageId(event: ClaudeStreamJsonEvent): string {
  const message = isRecord(event.message) ? event.message : null
  return typeof message?.id === "string" ? message.id : `${event.type ?? "claude"}-message`
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : JSON.stringify(item)))
      .join("\n")
  }
  return value === undefined ? "" : JSON.stringify(value)
}

export function createClaudeEventMapper(options: MapperOptions) {
  const now = options.now ?? Date.now
  const completedAssistantText = new Map<string, string>()
  const startedMessages = new Set<string>()
  const toolNames = new Map<string, string>()
  let providerThreadId = options.providerThreadId ?? null
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
        provider: "claude",
        providerThreadId,
        prompt: options.prompt,
        context: options.context,
        createdAt,
      },
    ]
  }

  function mapAssistant(event: ClaudeStreamJsonEvent, createdAt: number): AgentRuntimeEvent[] {
    const id = messageId(event)
    const events = ensureRunStarted(createdAt)
    const blocks = contentBlocks(event)
    const text = blocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("")

    if (text) {
      if (!startedMessages.has(id)) {
        startedMessages.add(id)
        events.push({ type: "assistant-message-started", runId: options.runId, messageId: id, createdAt })
      }
      const previous = completedAssistantText.get(id) ?? ""
      const delta = text.startsWith(previous) ? text.slice(previous.length) : text
      completedAssistantText.set(id, text)
      if (delta) {
        events.push({ type: "assistant-delta", runId: options.runId, messageId: id, delta, createdAt })
      }
      events.push({
        type: "assistant-message-completed",
        runId: options.runId,
        messageId: id,
        content: text,
        createdAt,
      })
    }

    for (const block of blocks) {
      if (block.type !== "tool_use" || !block.id) continue
      const name = block.name ?? "Claude tool"
      toolNames.set(block.id, name)
      events.push({ type: "tool-started", runId: options.runId, toolCallId: block.id, name, createdAt })
    }

    return events
  }

  function mapToolResults(event: ClaudeStreamJsonEvent, createdAt: number): AgentRuntimeEvent[] {
    const events = ensureRunStarted(createdAt)
    for (const block of contentBlocks(event)) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue
      events.push({
        type: "tool-completed",
        runId: options.runId,
        toolCallId: block.tool_use_id,
        name: toolNames.get(block.tool_use_id),
        output: stringifyToolOutput(block.content),
        createdAt,
      })
    }
    return events
  }

  return {
    map(event: ClaudeStreamJsonEvent): AgentRuntimeEvent[] {
      const createdAt = now()
      if (typeof event.session_id === "string") {
        providerThreadId = event.session_id
      }

      switch (event.type) {
        case "system":
          return ensureRunStarted(createdAt)
        case "assistant":
          return mapAssistant(event, createdAt)
        case "user":
          return mapToolResults(event, createdAt)
        case "result": {
          if (event.is_error === true || String(event.subtype ?? "").startsWith("error")) {
            return [
              ...ensureRunStarted(createdAt),
              {
                type: "run-failed",
                runId: options.runId,
                error:
                  typeof event.error === "string"
                    ? event.error
                    : typeof event.result === "string"
                      ? event.result
                      : "Claude Code run failed.",
                createdAt,
              },
            ]
          }
          return ensureRunStarted(createdAt)
        }
        default:
          return ensureRunStarted(createdAt)
      }
    },
    finalAssistantText(): string {
      const texts = Array.from(completedAssistantText.values())
      return texts[texts.length - 1] ?? ""
    },
    providerThreadId(): string | null {
      return providerThreadId
    },
  }
}
```

- [ ] **Step 4: Verify mapper tests pass**

Run:

```bash
npx vitest run --environment node runtime/claudeEventMapper.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/claudeEventMapper.ts runtime/claudeEventMapper.test.ts
git commit -m "feat: map claude code stream events"
```

---

## Task 5: Implement the Claude Provider

**Files:**
- Create: `runtime/claudeProvider.ts`
- Create: `runtime/claudeProvider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Create `runtime/claudeProvider.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import { createClaudeProvider, type ClaudeRunnerLike } from "./claudeProvider"

const request: StartRunRequest = {
  provider: "claude",
  nodeId: "node-1",
  prompt: "Create a child bullet.",
  context: "Context",
  outline: { rootIds: [], nodes: {}, focusedNodeId: "node-1" },
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

function runner(events: Array<Record<string, unknown>>): ClaudeRunnerLike {
  return {
    run: vi.fn(async function* () {
      for (const event of events) yield event
    }),
  }
}

describe("claudeProvider", () => {
  it("streams Claude events and emits a validated outline patch", async () => {
    const provider = createClaudeProvider({
      runner: runner([
        { type: "system", subtype: "init", session_id: "claude-session-1" },
        {
          type: "assistant",
          session_id: "claude-session-1",
          message: {
            id: "msg-1",
            type: "message",
            role: "assistant",
            content: [
              {
                type: "text",
                text: '<actionpad-outline-output>{"type":"append-child-bullets","parentId":"node-1","bullets":[{"text":"Child."}]}</actionpad-outline-output>',
              },
            ],
          },
        },
        { type: "result", subtype: "success", session_id: "claude-session-1", is_error: false },
      ]),
      workspace: "/repo/actionpad",
      config: { executable: "claude", permissionMode: "default", allowedTools: [], disallowedTools: [] },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run-started",
        provider: "claude",
        providerThreadId: "claude-session-1",
      }),
    )
    expect(events).toContainEqual({
      type: "outline-patch",
      runId: expect.any(String),
      patch: {
        type: "append-child-bullets",
        parentId: "node-1",
        bullets: [{ text: "Child." }],
      },
      createdAt: 100,
    })
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "run-completed" }))
  })

  it("resumes follow-up messages with providerThreadId", async () => {
    const fakeRunner = runner([{ type: "result", subtype: "success", session_id: "claude-session-1" }])
    const provider = createClaudeProvider({
      runner: fakeRunner,
      workspace: "/repo/actionpad",
      config: { executable: "claude", permissionMode: "default", allowedTools: [], disallowedTools: [] },
      now: () => 100,
    })

    await collect(
      provider.sendMessage({
        ...request,
        threadId: "thread-1",
        providerThreadId: "claude-session-1",
        prompt: "Follow up.",
      }),
    )

    expect(fakeRunner.run).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: "claude-session-1" }))
  })
})
```

- [ ] **Step 2: Run provider tests and verify they fail**

Run:

```bash
npx vitest run --environment node runtime/claudeProvider.test.ts
```

Expected: FAIL because `runtime/claudeProvider.ts` does not exist.

- [ ] **Step 3: Implement the provider**

Create `runtime/claudeProvider.ts`:

```ts
import type { SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider, AgentProviderEvent, AgentThreadSnapshot } from "./provider"
import type { ClaudeStreamJsonEvent } from "./claudeCliRunner"
import { buildActionpadPrompt } from "./actionpadPrompt"
import { createClaudeCliRunner } from "./claudeCliRunner"
import { createClaudeEventMapper } from "./claudeEventMapper"
import { extractOutlinePatch } from "./outlineOutput"
import type { RuntimeConfig } from "./codexConfig"

export type ClaudeRunnerLike = {
  run(options: {
    executable: string
    prompt: string
    workspace: string
    model?: string
    effort?: RuntimeConfig["claude"]["effort"]
    permissionMode: RuntimeConfig["claude"]["permissionMode"]
    allowedTools: string[]
    disallowedTools: string[]
    resumeSessionId?: string | null
    signal?: AbortSignal
  }): AsyncIterable<ClaudeStreamJsonEvent>
}

type ClaudeProviderOptions = {
  runner?: ClaudeRunnerLike
  workspace?: string
  config: RuntimeConfig["claude"]
  now?: () => number
}

export function createClaudeProvider(options: ClaudeProviderOptions): AgentProvider {
  const runner = options.runner ?? createClaudeCliRunner()
  const now = options.now ?? Date.now
  const activeControllers = new Map<string, AbortController>()
  const threads = new Map<string, AgentThreadSnapshot>()

  async function* runClaude(
    input: StartRunRequest | SendMessageRequest,
    mode: "initial" | "follow-up",
    ids: { runId: string; threadId: string; providerThreadId?: string | null },
  ): AsyncIterable<AgentProviderEvent> {
    const controller = new AbortController()
    const mapper = createClaudeEventMapper({
      runId: ids.runId,
      threadId: ids.threadId,
      nodeId: input.nodeId,
      providerThreadId: ids.providerThreadId,
      prompt: input.prompt,
      context: input.context,
      now,
    })
    let failed = false
    activeControllers.set(ids.runId, controller)

    try {
      for await (const event of runner.run({
        ...options.config,
        prompt: buildActionpadPrompt(input, mode),
        workspace: options.workspace ?? process.cwd(),
        resumeSessionId: ids.providerThreadId,
        signal: controller.signal,
      })) {
        for (const mapped of mapper.map(event)) {
          if (mapped.type === "run-failed") failed = true
          yield mapped
        }
      }

      const providerThreadId = mapper.providerThreadId() ?? ids.providerThreadId ?? null
      threads.set(ids.threadId, {
        id: ids.threadId,
        provider: "claude",
        providerThreadId,
        nodeId: input.nodeId,
        messages: [],
        runs: [ids.runId],
        providerMetadata: {},
      })

      if (failed) return

      const patch = extractOutlinePatch(mapper.finalAssistantText())
      if ("error" in patch) {
        yield { type: "run-failed", runId: ids.runId, error: patch.error, createdAt: now() }
        return
      }

      yield { type: "outline-patch", runId: ids.runId, patch, createdAt: now() }
      yield { type: "run-completed", runId: ids.runId, outcome: patch.outcome ?? "succeeded", createdAt: now() }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Claude Code runtime failed."
      yield { type: "run-failed", runId: ids.runId, error: message, createdAt: now() }
    } finally {
      activeControllers.delete(ids.runId)
    }
  }

  return {
    id: "claude",
    startRun(input) {
      const startedAt = now()
      return runClaude(input, "initial", {
        runId: `claude-run-${startedAt}`,
        threadId: `claude-thread-${startedAt}`,
      })
    },
    sendMessage(input) {
      const startedAt = now()
      const providerThreadId =
        input.providerThreadId ?? threads.get(input.threadId)?.providerThreadId ?? null
      return runClaude(input, "follow-up", {
        runId: `claude-run-${startedAt}`,
        threadId: input.threadId,
        providerThreadId,
      })
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

- [ ] **Step 4: Verify provider tests pass**

Run:

```bash
npx vitest run --environment node runtime/claudeProvider.test.ts runtime/claudeEventMapper.test.ts runtime/claudeCliRunner.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/claudeProvider.ts runtime/claudeProvider.test.ts
git commit -m "feat: add claude code provider"
```

---

## Task 6: Wire Claude into Runtime Startup

**Files:**
- Modify: `runtime/main.ts`
- Modify: `runtime/server.test.ts`
- Modify: `runtime/runtimeLogger.test.ts`

- [ ] **Step 1: Write/adjust tests for provider ids**

In `runtime/server.test.ts`, add a test that proves non-Codex providers are accepted when registered:

```ts
it("accepts registered Claude provider requests", async () => {
  const provider: AgentProvider = {
    id: "claude",
    async *startRun(request) {
      yield {
        type: "run-started",
        runId: "claude-run-1",
        threadId: "claude-thread-1",
        nodeId: request.nodeId,
        provider: "claude",
        createdAt: 100,
      }
    },
    async *sendMessage() {},
    cancelRun() {},
    getThread() {
      return null
    },
  }
  handle = await startRuntimeServer({ port: 0, providers: [provider] })

  const response = await fetch(`${handle.url}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeRunRequest({ provider: "claude" })),
  })

  expect(response.status).toBe(202)
})
```

If `makeRunRequest` is typed too narrowly, update its override type to `Partial<StartRunRequest>`.

- [ ] **Step 2: Run runtime server tests and verify the new test fails only on type/config gaps**

Run:

```bash
npx vitest run --environment node runtime/server.test.ts --runInBand
```

Expected locally outside this sandbox: FAIL before wiring if provider id types are still incomplete. In this sandbox, server binding may fail with `listen EPERM`; use the narrower type-level/lint verification if bind is blocked.

- [ ] **Step 3: Wire selected provider in `runtime/main.ts`**

Replace provider construction in `runtime/main.ts` with:

```ts
import { createClaudeProvider } from "./claudeProvider"
import { createCodexProvider } from "./codexProvider"
import { parseRuntimeConfig } from "./codexConfig"
import { createFakeProvider } from "./fakeProvider"
import type { AgentProvider } from "./provider"
import { startRuntimeServer } from "./server"

const config = parseRuntimeConfig(process.env, process.cwd())

function createSelectedProvider(): AgentProvider {
  switch (config.provider) {
    case "codex":
      return createCodexProvider({ config: config.codex, workspace: config.workspace })
    case "claude":
      return createClaudeProvider({ config: config.claude, workspace: config.workspace })
    case "fake":
      return createFakeProvider()
  }
}

const provider = createSelectedProvider()
const handle = await startRuntimeServer({
  port: config.port,
  providers: [provider],
  workspace: config.workspace,
})

console.log(`Actionpad runtime listening at ${handle.url}`)
console.log(`Actionpad provider: ${config.provider}`)
console.log(`Actionpad workspace: ${config.workspace}`)
if (config.provider === "codex") {
  console.log(
    `Actionpad Codex safety: sandbox=${config.codex.sandbox} approval=${config.codex.approval} network=${config.codex.network} webSearch=${config.codex.webSearch}`,
  )
}
if (config.provider === "claude") {
  console.log(
    `Actionpad Claude Code: executable=${config.claude.executable} permissionMode=${config.claude.permissionMode} model=${config.claude.model ?? "default"} effort=${config.claude.effort ?? "default"}`,
  )
}
```

Keep the existing shutdown handlers unchanged.

- [ ] **Step 4: Verify runtime wiring**

Run:

```bash
npx vitest run --environment node runtime/claudeProvider.test.ts runtime/codexProvider.test.ts runtime/codexConfig.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/main.ts runtime/server.test.ts runtime/runtimeLogger.test.ts
git commit -m "feat: wire claude provider into runtime startup"
```

---

## Task 7: Make Initial Browser Runs Provider-Aware

**Files:**
- Modify: `src/runtimeClient/runtimeClient.ts`
- Modify: `src/runtimeClient/runtimeClient.test.ts`
- Modify: `src/store/OutlineStore.tsx`
- Modify: `src/store/outlineReducer.ts`
- Modify: `src/store/outlineReducer.test.ts`

- [ ] **Step 1: Add failing client tests for default provider**

In `src/runtimeClient/runtimeClient.test.ts`, add:

```ts
import { getDefaultProvider } from "./runtimeClient"

it("defaults initial runs to Codex when no provider env is set", () => {
  expect(getDefaultProvider({})).toBe("codex")
})

it("uses Claude for initial runs when configured", () => {
  expect(getDefaultProvider({ VITE_ACTIONPAD_PROVIDER: "claude" })).toBe("claude")
})

it("falls back to Codex for unsupported browser provider env", () => {
  expect(getDefaultProvider({ VITE_ACTIONPAD_PROVIDER: "missing" })).toBe("codex")
})
```

- [ ] **Step 2: Run client tests and verify they fail**

Run:

```bash
npx vitest run src/runtimeClient/runtimeClient.test.ts --runInBand
```

Expected: FAIL because `getDefaultProvider` does not exist.

- [ ] **Step 3: Implement browser default provider helper**

In `src/runtimeClient/runtimeClient.ts`, import the type and add:

```ts
import type { AgentProviderId } from "../domain/runtimeProtocol"

export function getDefaultProvider(
  env: Record<string, string | undefined> = import.meta.env,
): AgentProviderId {
  return env.VITE_ACTIONPAD_PROVIDER === "claude" ? "claude" : "codex"
}
```

- [ ] **Step 4: Use default provider in `OutlineStore.tsx`**

Update imports:

```ts
import { ActionpadRuntimeClient, getDefaultProvider, getRuntimeUrl } from "../runtimeClient/runtimeClient"
```

Inside `executeNode`, change the request from:

```ts
provider: "codex",
```

to:

```ts
provider: getDefaultProvider(),
```

- [ ] **Step 5: Keep local failure provider accurate**

Change the `run-failed-local` action in `src/store/outlineReducer.ts` so it carries the provider attempted by the UI:

```ts
| {
    type: "run-failed-local"
    provider: AgentProviderId
    nodeId: BulletId
    threadId: ThreadId
    runId: RunId
    context: string
    error: string
    createdAt: number
  }
```

In `OutlineStore.tsx`, pass it:

```ts
provider: request.provider,
```

In the `run-failed-local` reducer case, replace both hardcoded `provider: "codex"` assignments with:

```ts
provider: action.provider,
```

- [ ] **Step 6: Add reducer coverage for local Claude failure**

In `src/store/outlineReducer.test.ts`, add:

```ts
it("records local runtime startup failures with the attempted provider", () => {
  const state = createInitialOutlineState()
  const nodeId = state.rootIds[0]

  const next = outlineReducer(state, {
    type: "run-failed-local",
    provider: "claude",
    nodeId,
    threadId: "thread-1",
    runId: "failed-run-1",
    context: "context",
    error: "Runtime unavailable.",
    createdAt: 100,
  })

  expect(next.threads["thread-1"].provider).toBe("claude")
  expect(next.runs["failed-run-1"].provider).toBe("claude")
})
```

- [ ] **Step 7: Verify frontend/provider tests pass**

Run:

```bash
npx vitest run src/runtimeClient/runtimeClient.test.ts src/store/outlineReducer.test.ts src/components/OutlineView.test.tsx --runInBand
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/runtimeClient/runtimeClient.ts src/runtimeClient/runtimeClient.test.ts src/store/OutlineStore.tsx src/store/outlineReducer.ts src/store/outlineReducer.test.ts
git commit -m "feat: make initial runs provider aware"
```

---

## Task 8: Document and Smoke-Test Claude Provider Usage

**Files:**
- Modify: `docs/actionpad-runtime.md`
- Optionally create: `runtime/claudeSmoke.test.ts` only if a non-network fake executable is useful.

- [ ] **Step 1: Update runtime docs**

Add this section to `docs/actionpad-runtime.md`:

```md
## Claude Code Provider

Actionpad can run against Claude Code instead of Codex by starting the runtime with:

```bash
ACTIONPAD_PROVIDER=claude \
VITE_ACTIONPAD_PROVIDER=claude \
npm run runtime:start
```

Useful Claude-specific runtime environment variables:

- `ACTIONPAD_CLAUDE_EXECUTABLE`: Claude executable path. Defaults to `claude`.
- `ACTIONPAD_CLAUDE_MODEL`: Optional Claude model alias or full model name, such as `sonnet`.
- `ACTIONPAD_CLAUDE_EFFORT`: Optional effort level: `low`, `medium`, `high`, `xhigh`, or `max`.
- `ACTIONPAD_CLAUDE_PERMISSION_MODE`: Permission mode passed to Claude Code. Defaults to `default`; common values are `acceptEdits`, `dontAsk`, and `plan`.
- `ACTIONPAD_CLAUDE_ALLOWED_TOOLS`: Comma-separated tool allow list, e.g. `Read,Edit,Bash(git *)`.
- `ACTIONPAD_CLAUDE_DISALLOWED_TOOLS`: Comma-separated tool deny list, e.g. `WebFetch,WebSearch`.

The first implementation uses Claude Code's non-interactive stream JSON CLI mode:

```bash
claude --print --output-format stream-json --include-partial-messages
```

Actionpad stores Claude's stream `session_id` as `providerThreadId`, and follow-up messages resume with `claude --resume <providerThreadId>`.
```

- [ ] **Step 2: Add manual smoke commands to the docs**

Add:

```md
### Manual smoke test

Run:

```bash
ACTIONPAD_PROVIDER=claude ACTIONPAD_CLAUDE_PERMISSION_MODE=acceptEdits npm run runtime:start
```

In another terminal, send a minimal request:

```bash
curl -sS http://127.0.0.1:43217/runs \
  -H 'content-type: application/json' \
  -d '{
    "provider": "claude",
    "nodeId": "manual-node",
    "prompt": "Append one child bullet that says Claude provider smoke passed.",
    "context": "manual smoke test",
    "outline": {
      "rootIds": ["manual-node"],
      "focusedNodeId": "manual-node",
      "nodes": {
        "manual-node": {
          "id": "manual-node",
          "parentId": null,
          "children": [],
          "text": "Append one child bullet that says Claude provider smoke passed.",
          "collapsed": false,
          "runStatus": "idle",
          "metadata": {}
        }
      }
    }
  }'
```

Expected HTTP response:

```json
{"accepted":true}
```

Then watch runtime logs and the browser websocket/chat panel for `run-started`, assistant text, `outline-patch`, and `run-completed`.
```

- [ ] **Step 3: Verify docs and tests**

Run:

```bash
npm run lint
npm run build
npx vitest run --environment node runtime/claudeCliRunner.test.ts runtime/claudeEventMapper.test.ts runtime/claudeProvider.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/actionpad-runtime.md
git commit -m "docs: document claude code provider"
```

---

## Task 9: End-to-End Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused provider/runtime tests**

Run:

```bash
npx vitest run --environment node \
  runtime/actionpadPrompt.test.ts \
  runtime/claudeCliRunner.test.ts \
  runtime/claudeEventMapper.test.ts \
  runtime/claudeProvider.test.ts \
  runtime/codexProvider.test.ts \
  runtime/codexConfig.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend/store tests touched by provider selection**

Run:

```bash
npx vitest run \
  src/runtimeClient/runtimeClient.test.ts \
  src/store/outlineReducer.test.ts \
  src/components/OutlineView.test.tsx \
  src/components/SidePanel.test.tsx \
  --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run full static checks**

Run:

```bash
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
npm test -- src
npm run runtime:test
```

Expected locally outside this sandbox: PASS. In this Codex sandbox, runtime server tests may fail at bind time with `listen EPERM` on `127.0.0.1`; if so, record that as an environment limitation and rely on non-listening runtime tests plus local manual smoke.

- [ ] **Step 5: Manual Claude smoke**

Run the manual smoke command from `docs/actionpad-runtime.md`.

Expected:

- The runtime accepts `/runs` with `provider: "claude"`.
- The first websocket event is `run-started` with `provider: "claude"`.
- `providerThreadId` is populated from Claude `session_id`.
- Assistant text appears in the chat panel.
- A valid Actionpad outline patch is applied.
- The run ends with `run-completed`.

- [ ] **Step 6: Commit final verification notes if docs changed**

```bash
git status --short
```

Expected: clean, or only intentional uncommitted local notes.

---

## Known Risks and Decisions

- This plan intentionally uses the Claude Code CLI streaming interface first because local help output confirms it. The npm package docs were not reachable from this sandbox.
- The `runtime/codexConfig.ts` name is now too Codex-specific. Keep it in this feature to reduce churn; rename to `runtime/runtimeConfig.ts` in a later cleanup.
- Claude's exact stream JSON event set may include additional fields/events. The mapper should ignore unknown events and only map known message, tool, system, and result shapes.
- If `claude --resume <session-id> --print` does not behave as expected in manual smoke, use `--session-id <uuid>` for Actionpad-created sessions instead: generate a UUID for initial run, pass it to Claude, store it as `providerThreadId`, and reuse it for follow-ups.
- If the CLI cannot be cleanly aborted by `AbortSignal`/`SIGTERM`, update `claudeCliRunner.ts` to escalate to `SIGKILL` after 1 second and keep the runtime's existing cancelled `run-failed` event behavior.
- If `--include-partial-messages` produces duplicate text snapshots, the mapper's delta logic should continue using prefix comparison, matching the Codex mapper pattern.

## Self-Review

- Spec coverage: The plan covers runtime provider implementation, Claude session ids, event mapping, cancellation, frontend initial provider selection, follow-up provider stickiness, backups, docs, and verification.
- Placeholder scan: No unresolved placeholder markers or unspecified test steps remain; every task has concrete files, code, commands, and expected results.
- Type consistency: Provider id is consistently `AgentProviderId = "codex" | "claude"`; Claude provider thread id maps to Claude `session_id`; Actionpad run ids use `claude-run-*`; Actionpad thread ids use `claude-thread-*`.
