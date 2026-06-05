# Actionpad Local MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Actionpad MCP server with starter tools for app refresh and deferred runtime restart, plus CLI management commands.

**Architecture:** Build a focused `runtime/mcp/` module that owns MCP tool definitions, policy checks, runtime HTTP calls, and audit logging. Expose the same tool registry through a stdio MCP entrypoint for Codex-launched agent sessions and a localhost Streamable HTTP MCP entrypoint for `actionpad mcp start/stop/restart/status`. Keep browser UI controls on direct runtime HTTP.

**Tech Stack:** Node 18+, TypeScript, Vitest, `@modelcontextprotocol/sdk`, `zod`, existing Actionpad runtime HTTP endpoints, existing `scripts/actionpad*.mjs` process helpers.

---

## Important Transport Clarification

The design spec says "stdio MCP first" and also asks for `actionpad mcp start/stop`. A stdio MCP server is normally launched and owned by an MCP client. Running it as a detached background daemon with ignored stdin is not useful, because there is no connected client stream.

This plan resolves that tension by implementing two entrypoints over the same registry:

- `npm run mcp:start`: foreground stdio MCP server for Codex or MCP Inspector style client-launched sessions.
- `actionpad mcp start/stop/restart/status`: managed localhost Streamable HTTP MCP server for manual/admin clients and diagnostics.

The agent-facing tool logic remains identical across transports.

## References

- Design spec: `docs/superpowers/specs/2026-06-05-actionpad-local-mcp-server-design.md`
- Runtime control endpoints: `runtime/server.ts`
- Runtime config: `runtime/codexConfig.ts`
- Codex provider prompt: `runtime/codexProvider.ts`
- CLI command: `scripts/actionpad.mjs`
- CLI paths: `scripts/actionpadPaths.mjs`
- Process helpers: `scripts/actionpadProcess.mjs`
- Official MCP TypeScript SDK: the stable v1 package is `@modelcontextprotocol/sdk`; the current upstream repo notes v2 split packages are pre-alpha, so this plan uses v1-style imports.

## File Structure

Create:

- `runtime/actionpadPrompt.ts`: shared Actionpad prompt builder, extracted from `runtime/codexProvider.ts`.
- `runtime/actionpadPrompt.test.ts`: prompt coverage, including MCP tool guidance.
- `runtime/mcp/config.ts`: environment parsing for MCP profile, runtime URL, audit log, transport, port.
- `runtime/mcp/config.test.ts`: MCP config tests.
- `runtime/mcp/types.ts`: shared MCP profile/tool/result types.
- `runtime/mcp/policy.ts`: profile-based tool visibility and call authorization.
- `runtime/mcp/policy.test.ts`: policy tests.
- `runtime/mcp/runtimeClient.ts`: small server-side HTTP client for Actionpad runtime control endpoints.
- `runtime/mcp/runtimeClient.test.ts`: fake-fetch tests.
- `runtime/mcp/auditLog.ts`: audit writer for stderr or newline-delimited JSON file.
- `runtime/mcp/auditLog.test.ts`: audit writer tests.
- `runtime/mcp/tools.ts`: tool schemas and handlers for `request_app_refresh` and `request_runtime_restart`.
- `runtime/mcp/tools.test.ts`: tool behavior tests.
- `runtime/mcp/server.ts`: MCP server factory that registers tools from the registry.
- `runtime/mcp/stdioMain.ts`: stdio MCP entrypoint.
- `runtime/mcp/httpMain.ts`: localhost Streamable HTTP MCP entrypoint for managed CLI use.
- `runtime/mcp/server.integration.test.ts`: MCP client integration tests for list/call.

Modify:

- `package.json`: add `mcp:start` script and dependencies.
- `package-lock.json`: lock dependency additions.
- `runtime/codexProvider.ts`: import shared `buildActionpadPrompt`.
- `runtime/codexProvider.test.ts`: adjust if prompt extraction changes imports or expectations.
- `runtime/codexConfig.ts`: add MCP config fields for Codex CLI integration.
- `runtime/codexConfig.test.ts`: cover MCP config defaults and overrides.
- `scripts/actionpadPaths.mjs`: add MCP PID/log paths.
- `scripts/actionpadPaths.test.mjs`: cover MCP paths.
- `scripts/actionpad.mjs`: add `actionpad mcp start/stop/restart/status`.
- `scripts/actionpad.test.mjs`: cover MCP CLI behavior.
- `docs/actionpad-runtime.md`: document MCP server commands and tools.
- `docs/superpowers/specs/2026-06-05-actionpad-local-mcp-server-design.md`: clarify the transport split found during planning.

---

## Task 1: Add MCP Dependencies And Package Scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add dependency entries to `package.json`**

Add `@modelcontextprotocol/sdk` and `zod` to dependencies, plus a foreground stdio script:

```json
{
  "scripts": {
    "mcp:start": "tsx runtime/mcp/stdioMain.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.2",
    "zod": "^3.25.0"
  }
}
```

Keep the existing scripts and dependencies intact; add only the new keys.

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install @modelcontextprotocol/sdk@^1.12.2 zod@^3.25.0
```

Expected: `package.json` and `package-lock.json` update successfully.

- [ ] **Step 3: Verify lockfile and package metadata**

Run:

```bash
npm run lint
```

Expected: PASS. This may still fail because MCP source files do not exist yet if TypeScript eagerly resolves script paths; if it fails only because `runtime/mcp/stdioMain.ts` does not exist yet, continue to Task 2 and re-run after Task 6.

- [ ] **Step 4: Commit dependency setup**

```bash
git add package.json package-lock.json
git commit -m "chore: add MCP server dependencies"
```

---

## Task 2: Clarify The Design Spec Transport Split

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-actionpad-local-mcp-server-design.md`

- [ ] **Step 1: Update the MCP entrypoints section**

Replace the entrypoint section with text matching this behavior:

```markdown
## MCP Server Entrypoints

Actionpad exposes the same MCP tool registry through two local transports:

- stdio, launched by an MCP client such as Codex.
- localhost Streamable HTTP, managed by `actionpad mcp start/stop/restart/status` for manual/admin clients and diagnostics.

`npm run mcp:start` starts the stdio server in the foreground. `actionpad mcp start` starts the localhost HTTP MCP server as a managed background process.
```

- [ ] **Step 2: Update acceptance criteria**

Ensure the criteria distinguish stdio and HTTP:

```markdown
- `npm run mcp:start` starts the stdio Actionpad MCP server.
- `actionpad mcp start` starts a localhost managed MCP HTTP server.
- Both transports expose the same profile-filtered tool registry.
```

- [ ] **Step 3: Run a docs diff check**

Run:

```bash
git diff -- docs/superpowers/specs/2026-06-05-actionpad-local-mcp-server-design.md
```

Expected: diff only clarifies transport behavior; it does not add new tools or broaden unsafe runtime control.

- [ ] **Step 4: Commit spec clarification**

```bash
git add docs/superpowers/specs/2026-06-05-actionpad-local-mcp-server-design.md
git commit -m "docs: clarify Actionpad MCP transports"
```

---

## Task 3: Extract The Actionpad Prompt And Add Tool Guidance

**Files:**
- Create: `runtime/actionpadPrompt.ts`
- Create: `runtime/actionpadPrompt.test.ts`
- Modify: `runtime/codexProvider.ts`
- Modify: `runtime/codexProvider.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Create `runtime/actionpadPrompt.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import { buildActionpadPrompt } from "./actionpadPrompt"

const request: StartRunRequest = {
  provider: "codex",
  nodeId: "node-1",
  prompt: "Update the app UI.",
  context: "Actionpad\nUpdate the app UI.",
}

describe("buildActionpadPrompt", () => {
  it("includes outline patch instructions", () => {
    const prompt = buildActionpadPrompt(request, "initial")

    expect(prompt).toContain("At the end, return exactly one outline patch")
    expect(prompt).toContain("append-child-bullets")
    expect(prompt).toContain("Executing bullet id: node-1")
  })

  it("instructs the agent when to use Actionpad MCP runtime tools", () => {
    const prompt = buildActionpadPrompt(request, "initial")

    expect(prompt).toContain("request_app_refresh")
    expect(prompt).toContain("request_runtime_restart")
    expect(prompt).toContain("Prefer request_app_refresh when a browser refresh is enough")
    expect(prompt).toContain("Do not use shell commands to stop or restart Actionpad")
    expect(prompt).not.toContain("curl -X POST")
  })
})
```

- [ ] **Step 2: Run the failing prompt test**

Run:

```bash
npm run runtime:test -- runtime/actionpadPrompt.test.ts
```

Expected: FAIL because `runtime/actionpadPrompt.ts` does not exist.

- [ ] **Step 3: Create shared prompt builder**

Create `runtime/actionpadPrompt.ts`:

```typescript
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
      : "For a follow-up, modify the existing outline as requested using the available bullet ids.",
    "Actionpad runtime tools:",
    "- Use request_app_refresh after you complete frontend, styling, browser-runtime, or UI-facing changes and the user would benefit from seeing the updated app. Also use it when the user explicitly asks you to refresh or reload the Actionpad app. Do not call it repeatedly; one request after the completed change is enough.",
    '- Use request_runtime_restart only when the user explicitly asks to restart or reload the runtime, or when you changed runtime/server/provider/MCP-tool code and those changes cannot be used until the runtime process reloads. Pass userIntent as "explicit_user_request" or "runtime_changes_need_reload". This tool requests a deferred restart; it must not kill the active run. Do not use shell commands to stop or restart Actionpad from inside an active Actionpad run.',
    "Prefer request_app_refresh when a browser refresh is enough. Use request_runtime_restart only when runtime process code or tool registration changed.",
    `Executing bullet id: ${input.nodeId}`,
    `Executing bullet text: ${input.prompt}`,
    "Ancestor bullets:",
    input.context,
  ].join("\n\n")
}
```

- [ ] **Step 4: Import the shared prompt in the Codex provider**

In `runtime/codexProvider.ts`, delete the local `buildActionpadPrompt` function and add:

```typescript
import { buildActionpadPrompt } from "./actionpadPrompt"
```

Leave the existing `thread.runStreamed(buildActionpadPrompt(...))` calls unchanged.

- [ ] **Step 5: Run prompt and provider tests**

Run:

```bash
npm run runtime:test -- runtime/actionpadPrompt.test.ts runtime/codexProvider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit prompt extraction**

```bash
git add runtime/actionpadPrompt.ts runtime/actionpadPrompt.test.ts runtime/codexProvider.ts runtime/codexProvider.test.ts
git commit -m "feat: add Actionpad MCP tool prompt guidance"
```

---

## Task 4: Add MCP Config, Types, Policy, Runtime Client, And Audit Log

**Files:**
- Create: `runtime/mcp/config.ts`
- Create: `runtime/mcp/config.test.ts`
- Create: `runtime/mcp/types.ts`
- Create: `runtime/mcp/policy.ts`
- Create: `runtime/mcp/policy.test.ts`
- Create: `runtime/mcp/runtimeClient.ts`
- Create: `runtime/mcp/runtimeClient.test.ts`
- Create: `runtime/mcp/auditLog.ts`
- Create: `runtime/mcp/auditLog.test.ts`

- [ ] **Step 1: Write config tests**

Create `runtime/mcp/config.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parseMcpConfig } from "./config"

describe("parseMcpConfig", () => {
  it("uses safe local defaults", () => {
    expect(parseMcpConfig({})).toEqual({
      runtimeUrl: "http://127.0.0.1:43217",
      profile: "agent",
      auditLogPath: null,
      httpPort: 43218,
    })
  })

  it("parses explicit MCP config", () => {
    expect(
      parseMcpConfig({
        ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:5000",
        ACTIONPAD_MCP_PROFILE: "admin",
        ACTIONPAD_MCP_AUDIT_LOG: "/tmp/actionpad-mcp.ndjson",
        ACTIONPAD_MCP_PORT: "5100",
      }),
    ).toEqual({
      runtimeUrl: "http://127.0.0.1:5000",
      profile: "admin",
      auditLogPath: "/tmp/actionpad-mcp.ndjson",
      httpPort: 5100,
    })
  })

  it("rejects invalid URLs and ports", () => {
    expect(() => parseMcpConfig({ ACTIONPAD_RUNTIME_URL: "file:///tmp/runtime" })).toThrow(
      "ACTIONPAD_RUNTIME_URL must use http or https.",
    )
    expect(() => parseMcpConfig({ ACTIONPAD_MCP_PORT: "0" })).toThrow(
      "ACTIONPAD_MCP_PORT must be a positive integer.",
    )
  })
})
```

- [ ] **Step 2: Write policy tests**

Create `runtime/mcp/policy.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { canCallTool, listAllowedToolNames } from "./policy"

describe("MCP profile policy", () => {
  it("advertises starter tools for agent profile", () => {
    expect(listAllowedToolNames("agent")).toEqual([
      "request_app_refresh",
      "request_runtime_restart",
    ])
  })

  it("fails closed for unknown profiles", () => {
    expect(listAllowedToolNames("unknown")).toEqual([])
    expect(canCallTool("unknown", "request_app_refresh", { reason: "test" })).toEqual({
      ok: false,
      error: "MCP profile is not allowed to call Actionpad tools.",
    })
  })

  it("allows app refresh without restart intent", () => {
    expect(canCallTool("agent", "request_app_refresh", { reason: "UI changed" })).toEqual({
      ok: true,
    })
  })

  it("requires restart user intent for agent profile", () => {
    expect(canCallTool("agent", "request_runtime_restart", { reason: "reload" })).toEqual({
      ok: false,
      error: "Runtime restart requires an allowed userIntent.",
    })
    expect(
      canCallTool("agent", "request_runtime_restart", {
        reason: "MCP tool code changed",
        userIntent: "runtime_changes_need_reload",
      }),
    ).toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: Write runtime client tests**

Create `runtime/mcp/runtimeClient.test.ts`:

```typescript
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRuntimeControlClient } from "./runtimeClient"

describe("createRuntimeControlClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts app refresh requests", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ requested: true }), { status: 202 }))
    const client = createRuntimeControlClient("http://127.0.0.1:43217")

    await expect(client.requestAppRefresh()).resolves.toEqual({ requested: true })
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:43217/app/refresh", { method: "POST" })
  })

  it("posts deferred restart requests", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ requested: true, pending: true }), { status: 202 }),
    )
    const client = createRuntimeControlClient("http://127.0.0.1:43217")

    await expect(client.requestRuntimeRestart()).resolves.toEqual({ requested: true, pending: true })
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:43217/runtime/restart", { method: "POST" })
  })

  it("raises runtime error text for non-OK responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Runtime is unavailable." }), { status: 503 }),
    )
    const client = createRuntimeControlClient("http://127.0.0.1:43217")

    await expect(client.requestAppRefresh()).rejects.toThrow("Runtime is unavailable.")
  })
})
```

- [ ] **Step 4: Write audit log tests**

Create `runtime/mcp/auditLog.test.ts`:

```typescript
// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAuditLogger } from "./auditLog"

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe("createAuditLogger", () => {
  it("writes newline-delimited JSON audit entries when a path is configured", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "actionpad-mcp-audit-"))
    const file = join(tempDir, "audit.ndjson")
    const logger = createAuditLogger({ path: file, stderr: vi.fn(), now: () => 123 })

    await logger.write({
      profile: "agent",
      tool: "request_app_refresh",
      arguments: { reason: "UI changed" },
      allowed: true,
      runtimeUrl: "http://127.0.0.1:43217",
      outcome: "requested",
    })

    expect((await readFile(file, "utf8")).trim()).toBe(
      JSON.stringify({
        timestamp: 123,
        profile: "agent",
        tool: "request_app_refresh",
        arguments: { reason: "UI changed" },
        allowed: true,
        runtimeUrl: "http://127.0.0.1:43217",
        outcome: "requested",
      }),
    )
  })
})
```

- [ ] **Step 5: Run failing tests**

Run:

```bash
npm run runtime:test -- runtime/mcp/config.test.ts runtime/mcp/policy.test.ts runtime/mcp/runtimeClient.test.ts runtime/mcp/auditLog.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 6: Implement shared MCP types**

Create `runtime/mcp/types.ts`:

```typescript
export type ActionpadMcpProfile = "agent" | "admin" | "unknown"
export type ActionpadMcpToolName = "request_app_refresh" | "request_runtime_restart"

export type PolicyResult = { ok: true } | { ok: false; error: string }

export type McpAuditEntry = {
  profile: string
  tool: string
  arguments: Record<string, unknown>
  allowed: boolean
  runtimeUrl: string
  outcome: string
}
```

- [ ] **Step 7: Implement MCP config parsing**

Create `runtime/mcp/config.ts`:

```typescript
import type { ActionpadMcpProfile } from "./types"

export type ActionpadMcpConfig = {
  runtimeUrl: string
  profile: ActionpadMcpProfile
  auditLogPath: string | null
  httpPort: number
}

export function parseMcpConfig(env: Record<string, string | undefined>): ActionpadMcpConfig {
  const runtimeUrl = env.ACTIONPAD_RUNTIME_URL || "http://127.0.0.1:43217"
  const parsedRuntimeUrl = new URL(runtimeUrl)
  if (parsedRuntimeUrl.protocol !== "http:" && parsedRuntimeUrl.protocol !== "https:") {
    throw new Error("ACTIONPAD_RUNTIME_URL must use http or https.")
  }

  const profileValue = env.ACTIONPAD_MCP_PROFILE || "agent"
  const profile: ActionpadMcpProfile =
    profileValue === "agent" || profileValue === "admin" ? profileValue : "unknown"

  const httpPort = Number(env.ACTIONPAD_MCP_PORT || "43218")
  if (!Number.isInteger(httpPort) || httpPort <= 0) {
    throw new Error("ACTIONPAD_MCP_PORT must be a positive integer.")
  }

  return {
    runtimeUrl: parsedRuntimeUrl.toString().replace(/\/+$/, ""),
    profile,
    auditLogPath: env.ACTIONPAD_MCP_AUDIT_LOG || null,
    httpPort,
  }
}
```

- [ ] **Step 8: Implement policy**

Create `runtime/mcp/policy.ts`:

```typescript
import type { ActionpadMcpProfile, ActionpadMcpToolName, PolicyResult } from "./types"

const TOOL_NAMES: ActionpadMcpToolName[] = ["request_app_refresh", "request_runtime_restart"]
const RESTART_INTENTS = new Set(["explicit_user_request", "runtime_changes_need_reload"])

export function listAllowedToolNames(profile: ActionpadMcpProfile): ActionpadMcpToolName[] {
  if (profile === "agent" || profile === "admin") return [...TOOL_NAMES]
  return []
}

export function canCallTool(
  profile: ActionpadMcpProfile,
  tool: string,
  args: Record<string, unknown>,
): PolicyResult {
  if (!listAllowedToolNames(profile).includes(tool as ActionpadMcpToolName)) {
    return { ok: false, error: "MCP profile is not allowed to call Actionpad tools." }
  }
  if (tool === "request_runtime_restart" && profile === "agent") {
    if (typeof args.userIntent !== "string" || !RESTART_INTENTS.has(args.userIntent)) {
      return { ok: false, error: "Runtime restart requires an allowed userIntent." }
    }
  }
  return { ok: true }
}
```

- [ ] **Step 9: Implement runtime HTTP client**

Create `runtime/mcp/runtimeClient.ts`:

```typescript
type AppRefreshResponse = { requested: boolean }
type RuntimeRestartResponse = { requested: boolean; pending: boolean }

export function createRuntimeControlClient(runtimeUrl: string) {
  const baseUrl = runtimeUrl.replace(/\/+$/, "")
  return {
    requestAppRefresh: () => postJson<AppRefreshResponse>(`${baseUrl}/app/refresh`),
    requestRuntimeRestart: () => postJson<RuntimeRestartResponse>(`${baseUrl}/runtime/restart`),
  }
}

async function postJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "POST" })
  if (!response.ok) {
    throw new Error((await parseRuntimeError(response)) ?? "Actionpad runtime request failed.")
  }
  return (await response.json()) as T
}

async function parseRuntimeError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : undefined
  } catch {
    return undefined
  }
}
```

- [ ] **Step 10: Implement audit logger**

Create `runtime/mcp/auditLog.ts`:

```typescript
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { McpAuditEntry } from "./types"

export function createAuditLogger({
  path,
  stderr = (message: string) => process.stderr.write(message),
  now = Date.now,
}: {
  path: string | null
  stderr?: (message: string) => void
  now?: () => number
}) {
  return {
    async write(entry: McpAuditEntry): Promise<void> {
      const payload = { timestamp: now(), ...entry }
      if (path) {
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8")
        return
      }
      stderr(`[actionpad-mcp] ${entry.tool} allowed=${entry.allowed} outcome=${entry.outcome}\n`)
    },
  }
}
```

- [ ] **Step 11: Run tests**

Run:

```bash
npm run runtime:test -- runtime/mcp/config.test.ts runtime/mcp/policy.test.ts runtime/mcp/runtimeClient.test.ts runtime/mcp/auditLog.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit MCP core**

```bash
git add runtime/mcp/config.ts runtime/mcp/config.test.ts runtime/mcp/types.ts runtime/mcp/policy.ts runtime/mcp/policy.test.ts runtime/mcp/runtimeClient.ts runtime/mcp/runtimeClient.test.ts runtime/mcp/auditLog.ts runtime/mcp/auditLog.test.ts
git commit -m "feat: add Actionpad MCP policy core"
```

---

## Task 5: Add MCP Tool Handlers

**Files:**
- Create: `runtime/mcp/tools.ts`
- Create: `runtime/mcp/tools.test.ts`

- [ ] **Step 1: Write tool handler tests**

Create `runtime/mcp/tools.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { callActionpadTool, listActionpadTools } from "./tools"

const auditLogger = { write: vi.fn(async () => undefined) }

describe("Actionpad MCP tools", () => {
  it("lists profile-allowed tools with input schemas", () => {
    expect(listActionpadTools("agent").map((tool) => tool.name)).toEqual([
      "request_app_refresh",
      "request_runtime_restart",
    ])
    expect(listActionpadTools("unknown")).toEqual([])
  })

  it("calls app refresh through the runtime client", async () => {
    const runtimeClient = {
      requestAppRefresh: vi.fn(async () => ({ requested: true })),
      requestRuntimeRestart: vi.fn(),
    }

    await expect(
      callActionpadTool({
        profile: "agent",
        runtimeUrl: "http://127.0.0.1:43217",
        runtimeClient,
        auditLogger,
        name: "request_app_refresh",
        arguments: { reason: "UI changed" },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            requested: true,
            runtimeUrl: "http://127.0.0.1:43217",
          }),
        },
      ],
    })
    expect(runtimeClient.requestAppRefresh).toHaveBeenCalledOnce()
  })

  it("denies restart calls without required agent intent", async () => {
    const runtimeClient = {
      requestAppRefresh: vi.fn(),
      requestRuntimeRestart: vi.fn(),
    }

    await expect(
      callActionpadTool({
        profile: "agent",
        runtimeUrl: "http://127.0.0.1:43217",
        runtimeClient,
        auditLogger,
        name: "request_runtime_restart",
        arguments: { reason: "reload" },
      }),
    ).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: "Runtime restart requires an allowed userIntent." }],
    })
    expect(runtimeClient.requestRuntimeRestart).not.toHaveBeenCalled()
  })

  it("calls deferred runtime restart when policy allows it", async () => {
    const runtimeClient = {
      requestAppRefresh: vi.fn(),
      requestRuntimeRestart: vi.fn(async () => ({ requested: true, pending: true })),
    }

    await expect(
      callActionpadTool({
        profile: "agent",
        runtimeUrl: "http://127.0.0.1:43217",
        runtimeClient,
        auditLogger,
        name: "request_runtime_restart",
        arguments: {
          reason: "MCP code changed",
          userIntent: "runtime_changes_need_reload",
        },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            requested: true,
            pending: true,
            runtimeUrl: "http://127.0.0.1:43217",
          }),
        },
      ],
    })
  })
})
```

- [ ] **Step 2: Run failing tool tests**

Run:

```bash
npm run runtime:test -- runtime/mcp/tools.test.ts
```

Expected: FAIL because `runtime/mcp/tools.ts` does not exist.

- [ ] **Step 3: Implement tool handlers**

Create `runtime/mcp/tools.ts`:

```typescript
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"
import { canCallTool, listAllowedToolNames } from "./policy"
import type { ActionpadMcpProfile } from "./types"

type RuntimeClient = {
  requestAppRefresh: () => Promise<{ requested: boolean }>
  requestRuntimeRestart: () => Promise<{ requested: boolean; pending: boolean }>
}

type AuditLogger = {
  write: (entry: {
    profile: string
    tool: string
    arguments: Record<string, unknown>
    allowed: boolean
    runtimeUrl: string
    outcome: string
  }) => Promise<void>
}

export function listActionpadTools(profile: ActionpadMcpProfile): Tool[] {
  const tools = new Map<string, Tool>([
    [
      "request_app_refresh",
      {
        name: "request_app_refresh",
        description:
          "Request that the Actionpad browser app refresh at a safe point.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Short reason for requesting the app refresh." },
          },
          required: ["reason"],
          additionalProperties: false,
        },
      },
    ],
    [
      "request_runtime_restart",
      {
        name: "request_runtime_restart",
        description:
          "Request a deferred Actionpad runtime restart after active runs finish.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Short reason for requesting the runtime restart." },
            userIntent: {
              type: "string",
              enum: ["explicit_user_request", "runtime_changes_need_reload"],
              description: "Why this restart is allowed for the current task.",
            },
          },
          required: ["reason", "userIntent"],
          additionalProperties: false,
        },
      },
    ],
  ])

  return listAllowedToolNames(profile).map((name) => tools.get(name)!)
}

export async function callActionpadTool({
  profile,
  runtimeUrl,
  runtimeClient,
  auditLogger,
  name,
  arguments: args,
}: {
  profile: ActionpadMcpProfile
  runtimeUrl: string
  runtimeClient: RuntimeClient
  auditLogger: AuditLogger
  name: string
  arguments: Record<string, unknown>
}): Promise<CallToolResult> {
  const policy = canCallTool(profile, name, args)
  if (!policy.ok) {
    await auditLogger.write({
      profile,
      tool: name,
      arguments: args,
      allowed: false,
      runtimeUrl,
      outcome: "denied",
    })
    return { isError: true, content: [{ type: "text", text: policy.error }] }
  }

  try {
    if (name === "request_app_refresh") {
      const result = await runtimeClient.requestAppRefresh()
      const output = { requested: result.requested, runtimeUrl }
      await auditLogger.write({ profile, tool: name, arguments: args, allowed: true, runtimeUrl, outcome: "requested" })
      return { content: [{ type: "text", text: JSON.stringify(output) }] }
    }

    if (name === "request_runtime_restart") {
      const result = await runtimeClient.requestRuntimeRestart()
      const output = { requested: result.requested, pending: result.pending, runtimeUrl }
      await auditLogger.write({ profile, tool: name, arguments: args, allowed: true, runtimeUrl, outcome: "requested" })
      return { content: [{ type: "text", text: JSON.stringify(output) }] }
    }

    return { isError: true, content: [{ type: "text", text: "Unknown Actionpad tool." }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Actionpad MCP tool failed."
    await auditLogger.write({ profile, tool: name, arguments: args, allowed: true, runtimeUrl, outcome: "error" })
    return { isError: true, content: [{ type: "text", text: message }] }
  }
}
```

- [ ] **Step 4: Run tool tests**

Run:

```bash
npm run runtime:test -- runtime/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit tool handlers**

```bash
git add runtime/mcp/tools.ts runtime/mcp/tools.test.ts
git commit -m "feat: add Actionpad MCP runtime control tools"
```

---

## Task 6: Add Stdio MCP Server Entrypoint

**Files:**
- Create: `runtime/mcp/server.ts`
- Create: `runtime/mcp/stdioMain.ts`
- Create: `runtime/mcp/server.integration.test.ts`

- [ ] **Step 1: Write an MCP stdio integration test**

Create `runtime/mcp/server.integration.test.ts`:

```typescript
// @vitest-environment node
import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

let fakeRuntime: Server | null = null

afterEach(async () => {
  if (!fakeRuntime) return
  await new Promise<void>((resolve) => fakeRuntime!.close(() => resolve()))
  fakeRuntime = null
})

function startFakeRuntime(): Promise<{ url: string; paths: string[] }> {
  const paths: string[] = []
  fakeRuntime = createServer((request, response) => {
    paths.push(request.url ?? "")
    if (request.url === "/runtime/restart") {
      response.writeHead(202, { "content-type": "application/json" })
      response.end(JSON.stringify({ requested: true, pending: false }))
      return
    }
    response.writeHead(202, { "content-type": "application/json" })
    response.end(JSON.stringify({ requested: true }))
  })
  return new Promise((resolve, reject) => {
    fakeRuntime!.once("error", reject)
    fakeRuntime!.listen(0, "127.0.0.1", () => {
      const address = fakeRuntime!.address()
      if (!address || typeof address === "string") throw new Error("Missing fake runtime address.")
      resolve({ url: `http://127.0.0.1:${address.port}`, paths })
    })
  })
}

describe("Actionpad MCP stdio server", () => {
  it("lists and calls runtime control tools", async () => {
    const runtime = await startFakeRuntime()
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["./node_modules/.bin/tsx", "runtime/mcp/stdioMain.ts"],
      env: {
        ...process.env,
        ACTIONPAD_RUNTIME_URL: runtime.url,
        ACTIONPAD_MCP_PROFILE: "agent",
      },
    })
    const client = new Client({ name: "actionpad-mcp-test", version: "0.0.0" })
    await client.connect(transport)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "request_app_refresh",
      "request_runtime_restart",
    ])

    await expect(
      client.callTool({
        name: "request_app_refresh",
        arguments: { reason: "UI changed" },
      }),
    ).resolves.toMatchObject({ isError: false })

    expect(runtime.paths).toContain("/app/refresh")
    await client.close()
  })
})
```

- [ ] **Step 2: Run failing integration test**

Run:

```bash
npm run runtime:test -- runtime/mcp/server.integration.test.ts
```

Expected: FAIL because `runtime/mcp/stdioMain.ts` and `runtime/mcp/server.ts` do not exist.

- [ ] **Step 3: Implement MCP server factory**

Create `runtime/mcp/server.ts`:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { ActionpadMcpConfig } from "./config"
import { createAuditLogger } from "./auditLog"
import { createRuntimeControlClient } from "./runtimeClient"
import { callActionpadTool, listActionpadTools } from "./tools"

export function createActionpadMcpServer(config: ActionpadMcpConfig): Server {
  const server = new Server(
    { name: "actionpad", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )
  const runtimeClient = createRuntimeControlClient(config.runtimeUrl)
  const auditLogger = createAuditLogger({ path: config.auditLogPath })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listActionpadTools(config.profile),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callActionpadTool({
      profile: config.profile,
      runtimeUrl: config.runtimeUrl,
      runtimeClient,
      auditLogger,
      name: request.params.name,
      arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
    }),
  )

  return server
}
```

- [ ] **Step 4: Implement stdio entrypoint**

Create `runtime/mcp/stdioMain.ts`:

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { parseMcpConfig } from "./config"
import { createActionpadMcpServer } from "./server"

const config = parseMcpConfig(process.env)
const server = createActionpadMcpServer(config)
const transport = new StdioServerTransport()

await server.connect(transport)
```

- [ ] **Step 5: Run MCP core tests**

Run:

```bash
npm run runtime:test -- runtime/mcp
```

Expected: PASS. If the integration test cannot bind localhost in the sandbox, run it with `CODEX_SANDBOX_NETWORK_DISABLED=0` in an environment that allows localhost binding.

- [ ] **Step 6: Commit stdio MCP entrypoint**

```bash
git add runtime/mcp/server.ts runtime/mcp/stdioMain.ts runtime/mcp/server.integration.test.ts
git commit -m "feat: expose Actionpad MCP server over stdio"
```

---

## Task 7: Add Managed HTTP MCP Entrypoint For CLI Commands

**Files:**
- Create: `runtime/mcp/httpMain.ts`
- Create: `runtime/mcp/httpMain.test.ts`

- [ ] **Step 1: Write HTTP entrypoint tests**

Create `runtime/mcp/httpMain.test.ts`:

```typescript
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { createMcpHealthResponse } from "./httpMain"

describe("MCP HTTP helpers", () => {
  it("creates a stable health response for CLI status checks", () => {
    expect(createMcpHealthResponse({ profile: "agent", runtimeUrl: "http://127.0.0.1:43217" })).toEqual({
      ok: true,
      name: "actionpad-mcp",
      profile: "agent",
      runtimeUrl: "http://127.0.0.1:43217",
    })
  })
})
```

- [ ] **Step 2: Run failing HTTP test**

Run:

```bash
npm run runtime:test -- runtime/mcp/httpMain.test.ts
```

Expected: FAIL because `runtime/mcp/httpMain.ts` does not exist.

- [ ] **Step 3: Implement HTTP entrypoint skeleton**

Create `runtime/mcp/httpMain.ts`.

The exported health helper must match the test:

```typescript
import { createServer } from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { parseMcpConfig, type ActionpadMcpConfig } from "./config"
import { createActionpadMcpServer } from "./server"

export function createMcpHealthResponse(config: Pick<ActionpadMcpConfig, "profile" | "runtimeUrl">) {
  return {
    ok: true,
    name: "actionpad-mcp",
    profile: config.profile,
    runtimeUrl: config.runtimeUrl,
  }
}

export async function startMcpHttpServer(config: ActionpadMcpConfig): Promise<{ url: string; close: () => Promise<void> }> {
  const mcpServer = createActionpadMcpServer(config)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await mcpServer.connect(transport)

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(createMcpHealthResponse(config)))
      return
    }
    if (request.url === "/mcp") {
      await transport.handleRequest(request, response)
      return
    }
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "Not found." }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.httpPort, "127.0.0.1", () => resolve())
  })

  return {
    url: `http://127.0.0.1:${config.httpPort}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const handle = await startMcpHttpServer(parseMcpConfig(process.env))
  console.error(`Actionpad MCP HTTP server listening at ${handle.url}`)
}
```

- [ ] **Step 4: Run HTTP tests**

Run:

```bash
npm run runtime:test -- runtime/mcp/httpMain.test.ts runtime/mcp/server.integration.test.ts
```

Expected: PASS. If localhost binding is blocked by the sandbox, re-run in an environment that allows localhost binding.

- [ ] **Step 5: Commit HTTP MCP entrypoint**

```bash
git add runtime/mcp/httpMain.ts runtime/mcp/httpMain.test.ts
git commit -m "feat: add managed Actionpad MCP HTTP entrypoint"
```

---

## Task 8: Add Actionpad MCP CLI Commands

**Files:**
- Modify: `scripts/actionpadPaths.mjs`
- Modify: `scripts/actionpadPaths.test.mjs`
- Modify: `scripts/actionpad.mjs`
- Modify: `scripts/actionpad.test.mjs`

- [ ] **Step 1: Add failing path tests**

Modify `scripts/actionpadPaths.test.mjs`:

```javascript
it("builds MCP process paths", () => {
  const paths = getActionpadPaths({ ACTIONPAD_HOME: "/tmp/actionpad-test" })
  expect(paths.mcpLog).toBe(path.join("/tmp/actionpad-test", "logs", "mcp.log"))
  expect(paths.mcpPid).toBe(path.join("/tmp/actionpad-test", "run", "mcp.pid"))
})
```

- [ ] **Step 2: Add failing CLI tests**

Modify `scripts/actionpad.test.mjs`:

```javascript
it("prints MCP status", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))

  const result = await runActionpad(["mcp", "status"], {
    env: { ...process.env, ACTIONPAD_HOME: home },
  })

  expect(result.stdout.split(/\r?\n/)[0]).toBe(versionLine)
  expect(result.stdout).toContain("mcp:")
  expect(result.stderr).toBe("")
})

it("rejects unknown MCP subcommands", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))

  await expect(
    runActionpad(["mcp", "explode"], {
      env: { ...process.env, ACTIONPAD_HOME: home },
    }),
  ).rejects.toMatchObject({
    stdout: expect.stringContaining(versionLine),
    stderr: expect.stringContaining("Usage: actionpad mcp [start|stop|restart|status]"),
  })
})
```

- [ ] **Step 3: Run failing CLI tests**

Run:

```bash
npm test -- scripts/actionpadPaths.test.mjs scripts/actionpad.test.mjs
```

Expected: FAIL because MCP paths and subcommands do not exist.

- [ ] **Step 4: Add MCP paths**

Modify `scripts/actionpadPaths.mjs`:

```javascript
mcpLog: path.join(home, "logs", "mcp.log"),
mcpPid: path.join(home, "run", "mcp.pid"),
```

Add these next to `runtimeLog`, `webLog`, `runtimePid`, and `webPid`.

- [ ] **Step 5: Add CLI usage and commands**

Modify `scripts/actionpad.mjs`.

Update `usage()`:

```javascript
return [
  "Usage: actionpad [start|stop|restart|open|status|doctor|update|mcp|--version]",
  "       actionpad start [--open]",
  "       actionpad mcp [start|stop|restart|status]",
  "       actionpad doctor [--deep]",
].join("\n")
```

Add:

```javascript
function mcpUsage() {
  return "Usage: actionpad mcp [start|stop|restart|status]"
}

function mcpHealthUrl(config) {
  return `http://${config.ACTIONPAD_HOST}:${config.ACTIONPAD_MCP_PORT || "43218"}/health`
}

async function startMcpActionpad() {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const appRoot = await getAppRoot(paths)
  const env = {
    ...process.env,
    ...config,
    ACTIONPAD_HOME: paths.home,
    ACTIONPAD_MCP_PORT: config.ACTIONPAD_MCP_PORT || "43218",
  }

  await removeStalePidFile(paths.mcpPid)
  if (!(await healthOk(mcpHealthUrl(config)))) {
    await startBackgroundProcess({
      command: npmCommand,
      args: ["run", "mcp:http"],
      cwd: appRoot,
      env,
      logFile: paths.mcpLog,
      pidFile: paths.mcpPid,
    })
  }
  await waitForHttpOk(mcpHealthUrl(config), { timeoutMs: 10_000, intervalMs: 250 })
  console.log(`mcp:     ${mcpHealthUrl(config)}`)
  console.log(`logs:    ${displayHomeRelative(paths.mcpLog)}`)
}

async function stopMcpActionpad() {
  const paths = getActionpadPaths()
  const result = await stopPidFileProcess(paths.mcpPid)
  if (result.status === "not-running") console.log("mcp: not running.")
  else console.log(`mcp: ${result.status} PID ${result.pid}.`)
}

async function statusMcpActionpad() {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const pid = await readPidFile(paths.mcpPid)
  console.log(`mcp:     ${pid ? `PID ${pid}` : "not running"}; health ${await healthOk(mcpHealthUrl(config)) ? "ok" : "not responding"}`)
}

async function mcpActionpad(args) {
  const [subcommand = "status"] = args
  if (subcommand === "start") return startMcpActionpad()
  if (subcommand === "stop") return stopMcpActionpad()
  if (subcommand === "restart") {
    await stopMcpActionpad()
    return startMcpActionpad()
  }
  if (subcommand === "status") return statusMcpActionpad()
  console.error(mcpUsage())
  process.exitCode = 1
}
```

In `main(argv)`, add:

```javascript
if (command === "mcp") return mcpActionpad(args)
```

- [ ] **Step 6: Add package script for HTTP MCP**

Modify `package.json` scripts:

```json
"mcp:http": "tsx runtime/mcp/httpMain.ts"
```

- [ ] **Step 7: Run CLI tests**

Run:

```bash
npm test -- scripts/actionpadPaths.test.mjs scripts/actionpad.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit CLI commands**

```bash
git add scripts/actionpadPaths.mjs scripts/actionpadPaths.test.mjs scripts/actionpad.mjs scripts/actionpad.test.mjs package.json package-lock.json
git commit -m "feat: add Actionpad MCP CLI commands"
```

---

## Task 9: Wire Codex Runtime MCP Configuration

**Files:**
- Modify: `runtime/codexConfig.ts`
- Modify: `runtime/codexConfig.test.ts`
- Modify: `runtime/codexProvider.ts`
- Modify: `runtime/codexProvider.test.ts`

- [ ] **Step 1: Add failing config tests**

Modify `runtime/codexConfig.test.ts`:

```typescript
it("defaults MCP tool exposure on for Codex runs", () => {
  const config = parseRuntimeConfig({}, "/repo/actionpad")

  expect(config.mcp).toEqual({
    enabled: true,
    profile: "agent",
    runtimeUrl: "http://127.0.0.1:5111",
  })
})

it("parses explicit MCP runtime configuration", () => {
  const config = parseRuntimeConfig(
    {
      ACTIONPAD_RUNTIME_PORT: "43217",
      ACTIONPAD_MCP_ENABLED: "false",
      ACTIONPAD_MCP_PROFILE: "admin",
      ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:43217",
    },
    "/repo/actionpad",
  )

  expect(config.mcp).toEqual({
    enabled: false,
    profile: "admin",
    runtimeUrl: "http://127.0.0.1:43217",
  })
})
```

- [ ] **Step 2: Run failing config tests**

Run:

```bash
npm run runtime:test -- runtime/codexConfig.test.ts
```

Expected: FAIL because `config.mcp` does not exist.

- [ ] **Step 3: Add MCP config fields**

Modify `RuntimeConfig` in `runtime/codexConfig.ts`:

```typescript
mcp: {
  enabled: boolean
  profile: "agent" | "admin"
  runtimeUrl: string
}
```

In `parseRuntimeConfig`, add:

```typescript
const runtimeUrl = env.ACTIONPAD_RUNTIME_URL ?? `http://127.0.0.1:${port}`
```

and return:

```typescript
mcp: {
  enabled: env.ACTIONPAD_MCP_ENABLED !== "false",
  profile: env.ACTIONPAD_MCP_PROFILE === "admin" ? "admin" : "agent",
  runtimeUrl,
},
```

- [ ] **Step 4: Configure Codex MCP server through SDK config**

Modify `runtime/codexProvider.ts` so MCP configuration is passed when constructing the Codex SDK client, not as a thread option.

Update `CodexProviderOptions`:

```typescript
type CodexProviderOptions = {
  codex?: CodexClientLike
  workspace?: string
  config?: Partial<RuntimeConfig["codex"]>
  mcp?: RuntimeConfig["mcp"]
  now?: () => number
}
```

Add a helper:

```typescript
function buildCodexClientConfig(options: CodexProviderOptions): Record<string, unknown> {
  const mcp = options.mcp
  if (!mcp || mcp.enabled === false) return {}
  return {
    mcp_servers: {
      actionpad: {
        command: "npm",
        args: ["run", "mcp:start"],
        env: {
          ACTIONPAD_MCP_PROFILE: mcp.profile ?? "agent",
          ACTIONPAD_RUNTIME_URL: mcp.runtimeUrl ?? "http://127.0.0.1:43217",
        },
      },
    },
  }
}
```

Then change Codex client creation:

```typescript
const codex = options.codex ?? new Codex({ config: buildCodexClientConfig(options) })
```

This step must be verified against TypeScript. The expected Codex CLI config shape is:

```toml
[mcp_servers.actionpad]
command = "npm"
args = ["run", "mcp:start"]
[mcp_servers.actionpad.env]
ACTIONPAD_MCP_PROFILE = "agent"
ACTIONPAD_RUNTIME_URL = "http://127.0.0.1:43217"
```

- [ ] **Step 5: Pass MCP config from runtime main**

Modify `runtime/main.ts`:

```typescript
const provider =
  config.provider === "codex"
    ? createCodexProvider({ config: config.codex, mcp: config.mcp, workspace: config.workspace })
    : createFakeProvider()
```

- [ ] **Step 6: Add provider test for MCP config propagation**

Modify `runtime/codexProvider.test.ts` with a test that captures Codex construction config. Use this expectation shape:

```typescript
expect(JSON.stringify(capturedConfig)).toContain("mcp_servers")
expect(JSON.stringify(capturedConfig)).toContain("actionpad")
expect(JSON.stringify(capturedConfig)).toContain("ACTIONPAD_RUNTIME_URL")
```

- [ ] **Step 7: Run config/provider tests**

Run:

```bash
npm run runtime:test -- runtime/codexConfig.test.ts runtime/codexProvider.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit Codex MCP wiring**

```bash
git add runtime/codexConfig.ts runtime/codexConfig.test.ts runtime/codexProvider.ts runtime/codexProvider.test.ts runtime/main.ts
git commit -m "feat: wire Actionpad MCP tools into Codex runtime"
```

---

## Task 10: Document MCP Usage

**Files:**
- Modify: `docs/actionpad-runtime.md`

- [ ] **Step 1: Add MCP documentation**

Add:

```markdown
## Actionpad MCP Server

Actionpad exposes agent tools through a local MCP server.

For Codex-launched agent sessions, the runtime config starts the stdio MCP server:

```bash
npm run mcp:start
```

For local manual/admin clients, manage the localhost MCP HTTP server with:

```bash
actionpad mcp start
actionpad mcp status
actionpad mcp restart
actionpad mcp stop
```

Initial tools:

- `request_app_refresh`: asks the browser app to refresh at a safe point.
- `request_runtime_restart`: asks the runtime to perform a deferred restart after active runs finish.

The browser app still uses direct runtime HTTP for UI controls. Agent tools use MCP so tool names, schemas, policy checks, and audit logging are centralized.
```

- [ ] **Step 2: Run docs sanity check**

Run:

```bash
rg "request_app_refresh|actionpad mcp|npm run mcp:start" docs/actionpad-runtime.md
```

Expected: all three phrases appear.

- [ ] **Step 3: Commit docs**

```bash
git add docs/actionpad-runtime.md
git commit -m "docs: document Actionpad MCP server"
```

---

## Task 11: Final Verification

**Files:**
- No file edits.

- [ ] **Step 1: Run MCP-focused tests**

Run:

```bash
npm run runtime:test -- runtime/mcp runtime/actionpadPrompt.test.ts runtime/codexConfig.test.ts runtime/codexProvider.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run CLI tests**

Run:

```bash
npm test -- scripts/actionpadPaths.test.mjs scripts/actionpad.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run full typecheck**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS, with the existing runtime server suite skipped when the sandbox network guard is active.

- [ ] **Step 5: Manual smoke test**

Run:

```bash
ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217 ACTIONPAD_MCP_PROFILE=agent npm run mcp:start
```

Expected: process waits for stdio MCP client input and does not print JSON-RPC noise to stdout.

In another shell, run:

```bash
actionpad mcp start
actionpad mcp status
actionpad mcp stop
```

Expected:

- `start` reports MCP URL/logs.
- `status` reports PID and health ok while running.
- `stop` reports stopped/not-running without touching runtime or web PIDs.

---

## Plan Self-Review

### Spec Coverage

- Local MCP server: covered by Tasks 4, 5, 6, and 7.
- Two starter tools: covered by Task 5.
- Profiles and permissions: covered by Task 4 policy tests and Task 5 call checks.
- Prompt updates: covered by Task 3.
- CLI `actionpad mcp start/stop/restart/status`: covered by Task 8.
- Runtime HTTP transport boundary: covered by Task 4 runtime client and Task 5 tool handlers.
- Audit logging: covered by Task 4.
- Docs: covered by Task 10.
- Final verification: covered by Task 11.

### Placeholder Scan

No `TBD`, `TODO`, "implement later", or unspecified feature sections remain. The plan chooses the v1 MCP SDK import paths explicitly: `@modelcontextprotocol/sdk/server/stdio.js` and `@modelcontextprotocol/sdk/server/streamableHttp.js`.

### Type Consistency

The plan consistently uses:

- `ActionpadMcpProfile`
- `ActionpadMcpToolName`
- `parseMcpConfig`
- `createRuntimeControlClient`
- `createAuditLogger`
- `listActionpadTools`
- `callActionpadTool`
- `createActionpadMcpServer`

No later task refers to a function that is not introduced earlier.

### Risk Notes

- The managed `actionpad mcp start` command needs a daemon-friendly transport, so the plan deliberately adds a localhost MCP HTTP entrypoint while retaining stdio as the Codex/client-launched path.
- The Codex SDK MCP config injection is planned through `new Codex({ config: ... })`, matching the installed SDK README pattern for CLI config overrides. Task 9 requires TypeScript verification and a provider test for this path.
