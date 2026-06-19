# Bun Runtime → Compiled Sidecar Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Actionpad runtime + MCP server to run under Bun and compile them into a single self-contained sidecar binary, with the frontend reading its runtime URL from injected config.

**Architecture:** Consolidate the three Node entrypoints (`runtime/main.ts`, `runtime/mcp/stdioMain.ts`, `runtime/mcp/httpMain.ts`) behind one argv-dispatched entry (`runtime/entry.ts`) that `bun build --compile` turns into a single executable. The codex provider currently re-execs itself via `node --import tsx runtime/mcp/stdioMain.ts` to host the per-run MCP stdio server; this becomes configurable so a compiled binary re-execs itself with `--mcp-stdio` instead. The frontend's `__ACTIONPAD_CONFIG__` global is extended to carry the runtime URL so it never hardcodes `localhost:5111`.

**Tech Stack:** Bun (production runtime + compiler), Node 20 + Vitest (test runner, unchanged), TypeScript, `@openai/codex-sdk`, `@modelcontextprotocol/sdk`, `ws`.

**This is Plan 1 of 2.** Plan 2 (the Tauri desktop shell) is authored separately after this plan executes, because it depends on the compiled sidecar produced here and on the Bun-compatibility gate (Task 1) passing.

## Global Constraints

- **Bun is the production runtime; Vitest stays on Node.** Do not migrate tests to `bun test`. All `vitest run` commands run under Node exactly as today.
- **The existing headless path must keep working.** `scripts/actionpad.mjs`, `scripts/serve-dist.mjs`, and the `npm run dev:all` browser loop stay functional throughout. We add an entry; we do not delete the Node tarball path in this plan.
- **No hardcoded `localhost` in the frontend.** The runtime URL must come from injected config or env, never a literal.
- **All 383 existing tests stay green.** Run `npm test` before declaring any task done that touches shared code.
- **Default ports unchanged:** runtime 5111 (packaged) / 43217 (dev); MCP 5112 / 43218; web 5110 / 5175.
- **Frozen-default behavior:** when the new stdio-spawn env vars are absent, behavior is byte-for-byte identical to today (`node --import tsx runtime/mcp/stdioMain.ts` from the repo root).

---

### Task 1: Bun compatibility gate — prove the runtime runs under Bun

This is the risk gate. Nothing else in the plan is worth building if `@openai/codex-sdk`, `ws`, and the MCP SDK do not load and run under Bun. We validate with an automated fake-provider end-to-end plus a one-time manual Codex run.

**Files:**
- Create: `scripts/smoke-bun.mjs`
- Modify: `package.json` (add `smoke:bun` script)

**Interfaces:**
- Consumes: existing `runtime/main.ts` entrypoint (run via `bun`), runtime HTTP API (`GET /health`, `POST /runs`, `GET /runs`).
- Produces: a repeatable smoke command `npm run smoke:bun` used as a regression check in later tasks.

- [ ] **Step 1: Install Bun and confirm version**

Run:
```bash
curl -fsSL https://bun.sh/install | bash
exec "$SHELL" -l
bun --version
```
Expected: prints a version `>= 1.1.0`. If `bun` is already installed, just confirm the version.

- [ ] **Step 2: Confirm the dependencies import under Bun**

Run:
```bash
bun -e "await import('@openai/codex-sdk'); await import('@modelcontextprotocol/sdk/server/stdio.js'); await import('ws'); console.log('imports-ok')"
```
Expected: prints `imports-ok` with no error. If this fails, STOP — record the failing module and fall back to the Node-bundling path noted in the spec (`docs/superpowers/specs/2026-06-19-actionpad-tauri-desktop-design.md`, risk #1) before continuing.

- [ ] **Step 3: Write the fake-provider smoke script**

Create `scripts/smoke-bun.mjs`:
```js
#!/usr/bin/env node
import { spawn } from "node:child_process"
import process from "node:process"

const PORT = 43900
const runtime = spawn("bun", ["runtime/entry.ts"], {
  env: {
    ...process.env,
    ACTIONPAD_PROVIDER: "fake",
    ACTIONPAD_RUNTIME_PORT: String(PORT),
    ACTIONPAD_MCP_ENABLED: "false",
  },
  stdio: ["ignore", "inherit", "inherit"],
})

const base = `http://127.0.0.1:${PORT}`

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("runtime did not become healthy")
}

async function main() {
  try {
    await waitForHealth()
    const start = await fetch(`${base}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "fake", nodeId: "node-1", prompt: "hello", context: "" }),
    })
    if (!start.ok) throw new Error(`POST /runs failed: ${start.status}`)
    console.log("smoke-bun: OK")
  } finally {
    runtime.kill("SIGTERM")
  }
}

main().catch((error) => {
  runtime.kill("SIGTERM")
  console.error("smoke-bun: FAIL", error)
  process.exit(1)
})
```

Note: this script references `runtime/entry.ts`, created in Task 5. Until then, run it against `runtime/main.ts` by temporarily changing the spawn args in Step 5 below.

- [ ] **Step 4: Add the npm script**

In `package.json` `scripts`, add:
```json
"smoke:bun": "node scripts/smoke-bun.mjs"
```

- [ ] **Step 5: Run the smoke against the CURRENT entrypoint**

Because `runtime/entry.ts` does not exist yet, temporarily run the existing entry to prove Bun runs the runtime today:
```bash
ACTIONPAD_PROVIDER=fake ACTIONPAD_RUNTIME_PORT=43900 ACTIONPAD_MCP_ENABLED=false bun runtime/main.ts &
sleep 1
curl -fsS http://127.0.0.1:43900/health && echo " health-ok"
curl -fsS -X POST http://127.0.0.1:43900/runs -H 'Content-Type: application/json' -d '{"provider":"fake","nodeId":"node-1","prompt":"hello","context":""}' && echo " run-ok"
kill %1
```
Expected: `{"ok":true}`-style health response then `health-ok`, and a 2xx for the run then `run-ok`.

- [ ] **Step 6: One-time manual Codex verification (record the result)**

With your real Codex credentials configured, run a single real Codex turn under Bun to confirm the SDK's subprocess handling works:
```bash
ACTIONPAD_PROVIDER=codex ACTIONPAD_RUNTIME_PORT=43901 bun runtime/main.ts
```
In a second terminal, POST a run and confirm streamed events arrive without a Bun-specific crash:
```bash
curl -fsS -X POST http://127.0.0.1:43901/runs -H 'Content-Type: application/json' -d '{"provider":"codex","nodeId":"node-1","prompt":"List two fruits as outline bullets.","context":""}'
```
Expected: the runtime logs streamed Codex events and a `run-completed`. Record PASS/FAIL in the task commit message. On FAIL, STOP and switch to the Node-bundling fallback.

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-bun.mjs package.json
git commit -m "test: add Bun runtime smoke gate"
```

---

### Task 2: Add stdio-spawn overrides to runtime config

The codex provider re-execs itself to host the per-run MCP stdio server. To let a compiled binary re-exec itself differently, the spawn command/args/cwd must come from config (defaulting to today's `node --import tsx` invocation).

**Files:**
- Modify: `runtime/codexConfig.ts:36-41` (extend `mcp` type), `runtime/codexConfig.ts:158-162` (parse new env)
- Test: `runtime/codexConfig.test.ts`

**Interfaces:**
- Consumes: `parseRuntimeConfig(env, defaultWorkspace)` (existing).
- Produces: `RuntimeConfig["mcp"]` gains optional `stdioCommand?: string`, `stdioArgs?: string[]`, `stdioCwd?: string`. Parsed from `ACTIONPAD_MCP_STDIO_COMMAND` (string), `ACTIONPAD_MCP_STDIO_ARGS` (JSON string array), `ACTIONPAD_MCP_STDIO_CWD` (string). Absent → `undefined`.

- [ ] **Step 1: Write the failing test**

Add to `runtime/codexConfig.test.ts`:
```ts
it("parses stdio spawn overrides when present", () => {
  const config = parseRuntimeConfig(
    {
      ACTIONPAD_MCP_STDIO_COMMAND: "/opt/actionpad-runtime",
      ACTIONPAD_MCP_STDIO_ARGS: '["--mcp-stdio"]',
      ACTIONPAD_MCP_STDIO_CWD: "/tmp/work",
    },
    "/workspace",
  )
  expect(config.mcp.stdioCommand).toBe("/opt/actionpad-runtime")
  expect(config.mcp.stdioArgs).toEqual(["--mcp-stdio"])
  expect(config.mcp.stdioCwd).toBe("/tmp/work")
})

it("leaves stdio spawn overrides undefined by default", () => {
  const config = parseRuntimeConfig({}, "/workspace")
  expect(config.mcp.stdioCommand).toBeUndefined()
  expect(config.mcp.stdioArgs).toBeUndefined()
  expect(config.mcp.stdioCwd).toBeUndefined()
})

it("ignores malformed stdio args JSON", () => {
  const config = parseRuntimeConfig({ ACTIONPAD_MCP_STDIO_ARGS: "not-json" }, "/workspace")
  expect(config.mcp.stdioArgs).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runtime/codexConfig.test.ts`
Expected: FAIL — `stdioCommand` etc. are `undefined`/type errors (properties do not exist).

- [ ] **Step 3: Extend the type**

In `runtime/codexConfig.ts`, change the `mcp` block of `RuntimeConfig` (lines 36-40):
```ts
  mcp: {
    enabled: boolean
    profile: McpRuntimeProfile
    runtimeUrl: string
    stdioCommand?: string
    stdioArgs?: string[]
    stdioCwd?: string
  }
```

- [ ] **Step 4: Add the JSON-array parser and parse the env**

In `runtime/codexConfig.ts`, add near the other `read*` helpers:
```ts
function readJsonStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed
    }
  } catch {
    return undefined
  }
  return undefined
}
```
Then change the returned `mcp` block (lines 158-162):
```ts
    mcp: {
      enabled: env.ACTIONPAD_MCP_ENABLED !== "false",
      profile: env.ACTIONPAD_MCP_PROFILE === "admin" ? "admin" : "agent",
      runtimeUrl,
      stdioCommand: env.ACTIONPAD_MCP_STDIO_COMMAND || undefined,
      stdioArgs: readJsonStringArray(env.ACTIONPAD_MCP_STDIO_ARGS),
      stdioCwd: env.ACTIONPAD_MCP_STDIO_CWD || undefined,
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- runtime/codexConfig.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add runtime/codexConfig.ts runtime/codexConfig.test.ts
git commit -m "feat: parse MCP stdio spawn overrides from env"
```

---

### Task 3: Make the codex MCP spawn use the overrides

`buildCodexClientConfig` hardcodes `command: process.execPath, args: ["--import", "tsx", "runtime/mcp/stdioMain.ts"], cwd: sourceRoot`. Switch to the configurable values, defaulting to today's behavior.

**Files:**
- Modify: `runtime/codexProvider.ts:45-62`
- Test: `runtime/codexProvider.test.ts`

**Interfaces:**
- Consumes: `RuntimeConfig["mcp"]` with optional `stdioCommand`/`stdioArgs`/`stdioCwd` (from Task 2).
- Produces: `buildCodexClientConfig(options)` returns `mcp_servers.actionpad.command/args/cwd` driven by the overrides when present.

- [ ] **Step 1: Write the failing test**

Add to `runtime/codexProvider.test.ts`:
```ts
it("uses stdio spawn overrides for the actionpad MCP server", () => {
  const config = buildCodexClientConfig({
    mcp: {
      enabled: true,
      profile: "agent",
      runtimeUrl: "http://127.0.0.1:5111",
      stdioCommand: "/opt/actionpad-runtime",
      stdioArgs: ["--mcp-stdio"],
      stdioCwd: "/tmp/work",
    },
  })
  const server = (config.mcp_servers as Record<string, any>).actionpad
  expect(server.command).toBe("/opt/actionpad-runtime")
  expect(server.args).toEqual(["--mcp-stdio"])
  expect(server.cwd).toBe("/tmp/work")
})

it("falls back to the tsx invocation when no overrides are set", () => {
  const config = buildCodexClientConfig({
    mcp: { enabled: true, profile: "agent", runtimeUrl: "http://127.0.0.1:5111" },
  })
  const server = (config.mcp_servers as Record<string, any>).actionpad
  expect(server.args).toEqual(["--import", "tsx", "runtime/mcp/stdioMain.ts"])
})
```
(Ensure `buildCodexClientConfig` is imported in the test file — it is already exported from `runtime/codexProvider.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runtime/codexProvider.test.ts`
Expected: FAIL — `command`/`args`/`cwd` still reflect the hardcoded tsx values.

- [ ] **Step 3: Use the overrides**

In `runtime/codexProvider.ts`, replace the `return` block of `buildCodexClientConfig` (lines 49-61):
```ts
  return {
    mcp_servers: {
      actionpad: {
        command: mcp.stdioCommand ?? process.execPath,
        args: mcp.stdioArgs ?? ["--import", "tsx", "runtime/mcp/stdioMain.ts"],
        cwd: mcp.stdioCwd ?? sourceRoot,
        env: {
          ACTIONPAD_MCP_PROFILE: mcp.profile ?? "agent",
          ACTIONPAD_RUNTIME_URL: mcp.runtimeUrl ?? "http://127.0.0.1:43217",
        },
      },
    },
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- runtime/codexProvider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/codexProvider.ts runtime/codexProvider.test.ts
git commit -m "feat: drive codex MCP spawn from stdio overrides"
```

---

### Task 4: Refactor entrypoints into callable run functions

`runtime/main.ts` runs its logic at module top level, and the MCP mains only run under an `import.meta` guard. To dispatch them from one entry, each must expose a callable function that starts the server and installs shutdown handlers.

**Files:**
- Modify: `runtime/main.ts` (wrap top-level into `startRuntimeFromEnv`)
- Modify: `runtime/mcp/stdioMain.ts` (export `runActionpadMcpStdio`)
- Modify: `runtime/mcp/httpMain.ts` (export `runActionpadMcpHttp`)
- Test: `runtime/runtimeEntry.test.ts` (new)

**Interfaces:**
- Produces:
  - `startRuntimeFromEnv(env?: Record<string, string | undefined>): Promise<Awaited<ReturnType<typeof startRuntimeServer>>>` in `runtime/main.ts`.
  - `runActionpadMcpStdio(env?: Record<string, string | undefined>): Promise<void>` in `runtime/mcp/stdioMain.ts`.
  - `runActionpadMcpHttp(env?: Record<string, string | undefined>): Promise<void>` in `runtime/mcp/httpMain.ts`.

- [ ] **Step 1: Write the failing test**

Create `runtime/runtimeEntry.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { startRuntimeFromEnv } from "./main"

describe("startRuntimeFromEnv", () => {
  it("starts a runtime with the fake provider and closes it", async () => {
    const handle = await startRuntimeFromEnv({
      ACTIONPAD_PROVIDER: "fake",
      ACTIONPAD_RUNTIME_PORT: "43950",
      ACTIONPAD_MCP_ENABLED: "false",
    })
    const res = await fetch(`${handle.url}/health`)
    expect(res.ok).toBe(true)
    await handle.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runtime/runtimeEntry.test.ts`
Expected: FAIL — `startRuntimeFromEnv` is not exported.

- [ ] **Step 3: Refactor `runtime/main.ts`**

Replace the entire body of `runtime/main.ts` with:
```ts
import { createClaudeProvider } from "./claudeProvider"
import { createCodexProvider } from "./codexProvider"
import { parseRuntimeConfig, type RuntimeConfig } from "./codexConfig"
import { createFakeProvider } from "./fakeProvider"
import type { AgentProvider } from "./provider"
import { requestRuntimeProcessRestart } from "./runtimeRestart"
import { startRuntimeServer } from "./server"

type RuntimeHandle = Awaited<ReturnType<typeof startRuntimeServer>>

function createSelectedProvider(config: RuntimeConfig): AgentProvider {
  switch (config.provider) {
    case "codex":
      return createCodexProvider({ config: config.codex, mcp: config.mcp, workspace: config.workspace })
    case "claude":
      return createClaudeProvider({ config: config.claude, workspace: config.workspace })
    case "fake":
      return createFakeProvider()
  }
}

export async function startRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<RuntimeHandle> {
  const config = parseRuntimeConfig(env, process.cwd())
  const provider = createSelectedProvider(config)
  let handle: RuntimeHandle
  handle = await startRuntimeServer({
    port: config.port,
    providers: [provider],
    workspace: config.workspace,
    runtimeController: {
      requestRestart: () => requestRuntimeProcessRestart({ handle }),
    },
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

  return handle
}

export function installRuntimeShutdownHandlers(handle: RuntimeHandle): void {
  async function shutdown(): Promise<void> {
    await handle.close()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- runtime/runtimeEntry.test.ts`
Expected: PASS.

- [ ] **Step 5: Export run functions from the MCP mains**

In `runtime/mcp/stdioMain.ts`, refactor `installShutdownHandlers` + `main` into an exported function. Replace the `main` function (lines 51-54) and add an export:
```ts
export async function runActionpadMcpStdio(env: Env = process.env): Promise<void> {
  const server = await startActionpadMcpStdioServer(env)
  installShutdownHandlers(server)
}
```
Update the `import.meta` guard at the bottom to call it:
```ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runActionpadMcpStdio().catch((error) => {
    console.error("Actionpad MCP server failed:", error)
    process.exit(1)
  })
}
```

In `runtime/mcp/httpMain.ts`, replace `main` (lines 188-191) with an export:
```ts
export async function runActionpadMcpHttp(env: Env = process.env): Promise<void> {
  const handle = await startActionpadMcpHttpServerFromEnv(env)
  installShutdownHandlers(handle)
}
```
Update the bottom guard:
```ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runActionpadMcpHttp().catch((error) => {
    console.error("Actionpad MCP HTTP server failed:", error)
    process.exit(1)
  })
}
```
Note: `startActionpadMcpHttpServerFromEnv` currently ignores its `env` for nothing — confirm it accepts `env` (it does: signature `(env: Env = process.env)`).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass (was 383; now higher with the new tests).

- [ ] **Step 7: Commit**

```bash
git add runtime/main.ts runtime/mcp/stdioMain.ts runtime/mcp/httpMain.ts runtime/runtimeEntry.test.ts
git commit -m "refactor: expose runtime and MCP entrypoints as callable run functions"
```

---

### Task 5: Add the unified argv-dispatched entry and compiled-binary detection

One entry that `bun build --compile` turns into the binary; `--mcp-stdio` / `--mcp-http` select the MCP modes; default selects the runtime.

**Files:**
- Create: `runtime/entry.ts`
- Create: `runtime/isCompiledRuntime.ts`
- Test: `runtime/isCompiledRuntime.test.ts`

**Interfaces:**
- Consumes: `startRuntimeFromEnv` + `installRuntimeShutdownHandlers` (Task 4), `runActionpadMcpStdio`, `runActionpadMcpHttp` (Task 4).
- Produces: `isCompiledRuntime(execPath: string): boolean` — true when the executable basename is not `bun`/`node`. `runtime/entry.ts` as the single compile target.

- [ ] **Step 1: Write the failing test**

Create `runtime/isCompiledRuntime.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { isCompiledRuntime } from "./isCompiledRuntime"

describe("isCompiledRuntime", () => {
  it("returns false for node and bun hosts", () => {
    expect(isCompiledRuntime("/usr/local/bin/node")).toBe(false)
    expect(isCompiledRuntime("/Users/me/.bun/bin/bun")).toBe(false)
    expect(isCompiledRuntime("C:\\Program Files\\nodejs\\node.exe")).toBe(false)
  })

  it("returns true for a compiled binary name", () => {
    expect(isCompiledRuntime("/Applications/Actionpad.app/Contents/Resources/actionpad-runtime")).toBe(true)
    expect(isCompiledRuntime("/opt/actionpad-runtime")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runtime/isCompiledRuntime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the detector**

Create `runtime/isCompiledRuntime.ts`:
```ts
import { basename } from "node:path"

export function isCompiledRuntime(execPath: string): boolean {
  const name = basename(execPath).toLowerCase().replace(/\.exe$/, "")
  return name !== "bun" && name !== "node"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- runtime/isCompiledRuntime.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the unified entry**

Create `runtime/entry.ts`:
```ts
import { installRuntimeShutdownHandlers, startRuntimeFromEnv } from "./main"
import { runActionpadMcpHttp } from "./mcp/httpMain"
import { runActionpadMcpStdio } from "./mcp/stdioMain"
import { isCompiledRuntime } from "./isCompiledRuntime"

const mode = process.argv[2]

async function runRuntime(): Promise<void> {
  // When running as a compiled binary, re-exec THIS binary for the per-run MCP
  // stdio server instead of `node --import tsx runtime/mcp/stdioMain.ts`.
  if (isCompiledRuntime(process.execPath)) {
    process.env.ACTIONPAD_MCP_STDIO_COMMAND ??= process.execPath
    process.env.ACTIONPAD_MCP_STDIO_ARGS ??= JSON.stringify(["--mcp-stdio"])
    process.env.ACTIONPAD_MCP_STDIO_CWD ??= process.cwd()
  }
  const handle = await startRuntimeFromEnv()
  installRuntimeShutdownHandlers(handle)
}

async function main(): Promise<void> {
  if (mode === "--mcp-stdio") {
    await runActionpadMcpStdio({ ...process.env, ACTIONPAD_MCP_TRANSPORT: "stdio" })
    return
  }
  if (mode === "--mcp-http") {
    await runActionpadMcpHttp({ ...process.env, ACTIONPAD_MCP_TRANSPORT: "http" })
    return
  }
  await runRuntime()
}

main().catch((error) => {
  console.error("Actionpad runtime entry failed:", error)
  process.exit(1)
})
```

- [ ] **Step 6: Verify dispatch under Bun (runtime + stdio mode)**

Runtime mode:
```bash
ACTIONPAD_PROVIDER=fake ACTIONPAD_RUNTIME_PORT=43952 ACTIONPAD_MCP_ENABLED=false bun runtime/entry.ts &
sleep 1
curl -fsS http://127.0.0.1:43952/health && echo " entry-runtime-ok"
kill %1
```
Expected: healthy response then `entry-runtime-ok`.

MCP stdio mode (send an initialize request and confirm a JSON-RPC reply):
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | bun runtime/entry.ts --mcp-stdio
```
Expected: a single JSON-RPC line on stdout containing `"result"` and `"serverInfo"`, plus `Actionpad MCP server running on stdio.` on stderr.

- [ ] **Step 7: Commit**

```bash
git add runtime/entry.ts runtime/isCompiledRuntime.ts runtime/isCompiledRuntime.test.ts
git commit -m "feat: add unified argv-dispatched runtime entry"
```

---

### Task 6: Point scripts at the unified entry and confirm the Bun smoke

Update package scripts to use `runtime/entry.ts` (run via Bun) and finalize the smoke script from Task 1 against the real entry.

**Files:**
- Modify: `package.json` (`runtime:start`, `runtime:dev`, `mcp:start`, `mcp:http`)
- Test: `scripts/packageScripts.test.mjs`

**Interfaces:**
- Consumes: `runtime/entry.ts` (Task 5).
- Produces: scripts that launch the runtime/MCP via Bun + the unified entry.

- [ ] **Step 1: Write the failing test**

Add to `scripts/packageScripts.test.mjs` (this file already asserts on package scripts; follow its existing pattern):
```js
it("runs the runtime through the unified Bun entry", () => {
  const pkg = readPackageJson()
  expect(pkg.scripts["runtime:start"]).toBe("bun runtime/entry.ts")
  expect(pkg.scripts["mcp:start"]).toBe("bun runtime/entry.ts --mcp-stdio")
  expect(pkg.scripts["mcp:http"]).toContain("bun runtime/entry.ts --mcp-http")
})
```
If `readPackageJson` does not exist in that test file, read `package.json` inline with `JSON.parse(readFileSync(...))` matching the file's existing imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scripts/packageScripts.test.mjs`
Expected: FAIL — scripts still use `node --import tsx`.

- [ ] **Step 3: Update the scripts**

In `package.json`, set:
```json
"runtime:start": "bun runtime/entry.ts",
"runtime:dev": "ACTIONPAD_RUNTIME_PORT=43217 bun runtime/entry.ts",
"mcp:start": "bun runtime/entry.ts --mcp-stdio",
"mcp:http": "ACTIONPAD_MCP_TRANSPORT=http bun runtime/entry.ts --mcp-http",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scripts/packageScripts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the end-to-end Bun smoke**

Run: `npm run smoke:bun`
Expected: prints `smoke-bun: OK` and exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/packageScripts.test.mjs
git commit -m "feat: launch runtime and MCP via Bun unified entry"
```

---

### Task 7: Compile the sidecar binary and smoke-test it

Produce the single self-contained executable with `bun build --compile` and verify it boots and serves `--mcp-stdio`.

**Files:**
- Create: `scripts/build-sidecar.mjs`
- Create: `scripts/smoke-sidecar.mjs`
- Modify: `package.json` (`build:sidecar`, `smoke:sidecar` scripts), `.gitignore` (ignore the built binary)

**Interfaces:**
- Consumes: `runtime/entry.ts` (Task 5).
- Produces: a compiled binary at `dist-runtime/actionpad-runtime` and a smoke command that runs it with the fake provider.

- [ ] **Step 1: Write the build script**

Create `scripts/build-sidecar.mjs`:
```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import process from "node:process"

mkdirSync("dist-runtime", { recursive: true })

const result = spawnSync(
  "bun",
  ["build", "runtime/entry.ts", "--compile", "--outfile", "dist-runtime/actionpad-runtime"],
  { stdio: "inherit" },
)

process.exit(result.status ?? 1)
```

- [ ] **Step 2: Write the compiled-binary smoke script**

Create `scripts/smoke-sidecar.mjs`:
```js
#!/usr/bin/env node
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import process from "node:process"

const BIN = "dist-runtime/actionpad-runtime"
if (!existsSync(BIN)) {
  console.error(`smoke-sidecar: missing ${BIN} — run npm run build:sidecar first`)
  process.exit(1)
}

const PORT = 43960
const runtime = spawn(BIN, [], {
  env: {
    ...process.env,
    ACTIONPAD_PROVIDER: "fake",
    ACTIONPAD_RUNTIME_PORT: String(PORT),
    ACTIONPAD_MCP_ENABLED: "false",
  },
  stdio: ["ignore", "inherit", "inherit"],
})

const base = `http://127.0.0.1:${PORT}`

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("compiled runtime did not become healthy")
}

async function main() {
  try {
    await waitForHealth()
    console.log("smoke-sidecar: OK")
  } finally {
    runtime.kill("SIGTERM")
  }
}

main().catch((error) => {
  runtime.kill("SIGTERM")
  console.error("smoke-sidecar: FAIL", error)
  process.exit(1)
})
```

- [ ] **Step 3: Add the npm scripts and gitignore the binary**

In `package.json` `scripts`:
```json
"build:sidecar": "node scripts/build-sidecar.mjs",
"smoke:sidecar": "node scripts/smoke-sidecar.mjs"
```
Add to `.gitignore`:
```
dist-runtime/
```

- [ ] **Step 4: Build the binary**

Run: `npm run build:sidecar`
Expected: prints Bun build output and exits 0; `dist-runtime/actionpad-runtime` exists (`ls -lh dist-runtime/actionpad-runtime` shows a ~40-60MB file).

- [ ] **Step 5: Smoke the compiled runtime**

Run: `npm run smoke:sidecar`
Expected: prints `smoke-sidecar: OK`.

- [ ] **Step 6: Verify the compiled binary's `--mcp-stdio` mode**

Run:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | ./dist-runtime/actionpad-runtime --mcp-stdio
```
Expected: a JSON-RPC line containing `"result"` and `"serverInfo"` on stdout.

- [ ] **Step 7: Manual compiled Codex verification (record the result)**

Run the compiled binary with the real Codex provider and confirm the re-exec MCP spawn works end to end:
```bash
ACTIONPAD_PROVIDER=codex ACTIONPAD_RUNTIME_PORT=43961 ./dist-runtime/actionpad-runtime
```
POST a run as in Task 1 Step 6. Expected: streamed Codex events + `run-completed`, and (if MCP is enabled) no spawn error referencing `tsx` or `$bunfs`. Record PASS/FAIL in the commit message.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-sidecar.mjs scripts/smoke-sidecar.mjs package.json .gitignore
git commit -m "feat: compile runtime into self-contained Bun sidecar"
```

---

### Task 8: Carry the runtime URL in the injected frontend config

The frontend reads `provider` from `__ACTIONPAD_CONFIG__` but the runtime URL only from `import.meta.env`. Extend the global and `getRuntimeUrl` so the Tauri shell (Plan 2) can inject the bound URL, with no hardcoded localhost.

**Files:**
- Modify: `src/runtimeClient/runtimeClient.ts:190-206`
- Modify: `scripts/serve-dist.mjs:59-62` (include `runtimeUrl` in the injected config so the existing web path stays consistent)
- Test: `src/runtimeClient/runtimeClient.test.ts`, `scripts/serve-dist.test.mjs`

**Interfaces:**
- Consumes: `window.__ACTIONPAD_CONFIG__` global, now shaped `{ provider?: "codex" | "claude"; runtimeUrl?: string }`.
- Produces: `getRuntimeUrl(env?, globalConfig?)` prefers `globalConfig.runtimeUrl`, then `import.meta.env.VITE_ACTIONPAD_RUNTIME_URL`, then the default.

- [ ] **Step 1: Write the failing test**

Add to `src/runtimeClient/runtimeClient.test.ts`:
```ts
it("prefers the injected runtimeUrl from global config", () => {
  expect(getRuntimeUrl({}, { runtimeUrl: "http://127.0.0.1:43217" })).toBe("http://127.0.0.1:43217")
})

it("falls back to the env runtime URL then the default", () => {
  expect(getRuntimeUrl({ VITE_ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:7000" }, {})).toBe(
    "http://127.0.0.1:7000",
  )
  expect(getRuntimeUrl({}, {})).toBe("http://127.0.0.1:5111")
})
```
(Import `getRuntimeUrl` if not already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/runtimeClient/runtimeClient.test.ts`
Expected: FAIL — `getRuntimeUrl` takes no arguments today.

- [ ] **Step 3: Update `getRuntimeUrl`**

In `src/runtimeClient/runtimeClient.ts`, replace `getRuntimeUrl` (lines 190-192):
```ts
type ActionpadGlobalConfig = { provider?: AgentProviderId; runtimeUrl?: string }

function readGlobalConfig(): ActionpadGlobalConfig {
  const value = (globalThis as Record<string, unknown>)[globalActionpadConfig]
  return value && typeof value === "object" ? (value as ActionpadGlobalConfig) : {}
}

export function getRuntimeUrl(
  env: Record<string, string | undefined> = import.meta.env,
  globalConfig: ActionpadGlobalConfig = readGlobalConfig(),
): string {
  return globalConfig.runtimeUrl ?? env.VITE_ACTIONPAD_RUNTIME_URL ?? DEFAULT_RUNTIME_URL
}
```
Then refactor `getDefaultProvider` (lines 194-206) to reuse `readGlobalConfig`:
```ts
export function getDefaultProvider(
  env: Record<string, string | undefined> = import.meta.env,
): AgentProviderId {
  if (readGlobalConfig().provider === "claude") {
    return "claude"
  }
  return env.VITE_ACTIONPAD_PROVIDER === "claude" ? "claude" : "codex"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/runtimeClient/runtimeClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Include runtimeUrl in the served config (web path consistency)**

In `scripts/serve-dist.mjs`, update `buildActionpadConfigScript` (lines 59-62):
```js
export function buildActionpadConfigScript(env = process.env) {
  const provider = env.ACTIONPAD_PROVIDER === "claude" ? "claude" : "codex"
  const config = { provider }
  if (env.ACTIONPAD_PUBLIC_RUNTIME_URL) {
    config.runtimeUrl = env.ACTIONPAD_PUBLIC_RUNTIME_URL
  }
  return `<script>window.__ACTIONPAD_CONFIG__=${JSON.stringify(config)}</script>`
}
```

- [ ] **Step 6: Write and run the serve-dist test**

Add to `scripts/serve-dist.test.mjs`:
```js
it("includes runtimeUrl in the injected config when set", () => {
  const script = buildActionpadConfigScript({
    ACTIONPAD_PROVIDER: "codex",
    ACTIONPAD_PUBLIC_RUNTIME_URL: "http://127.0.0.1:5111",
  })
  expect(script).toContain('"runtimeUrl":"http://127.0.0.1:5111"')
})

it("omits runtimeUrl when not set", () => {
  const script = buildActionpadConfigScript({ ACTIONPAD_PROVIDER: "codex" })
  expect(script).not.toContain("runtimeUrl")
})
```
Run: `npm test -- scripts/serve-dist.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/runtimeClient/runtimeClient.ts scripts/serve-dist.mjs src/runtimeClient/runtimeClient.test.ts scripts/serve-dist.test.mjs
git commit -m "feat: carry runtime URL in injected frontend config"
```

---

## Final verification

- [ ] **Run the full test suite:** `npm test` — all pass.
- [ ] **Run the type check:** `npm run lint` — no errors.
- [ ] **Run both smokes:** `npm run smoke:bun && npm run build:sidecar && npm run smoke:sidecar` — all print `OK`.
- [ ] **Confirm the headless path still works:** `npm run dev:all`, open the browser app, run a turn (manual).

## What this plan produces

A single compiled `dist-runtime/actionpad-runtime` binary that:
- serves the runtime HTTP+WS API (default mode),
- hosts the MCP server in `--mcp-stdio` and `--mcp-http` modes,
- re-execs itself for the per-run codex MCP stdio server,
- requires no Node or `tsx` install to run.

Plus a frontend that reads its runtime URL from injected config. This is everything Plan 2 (the Tauri shell) needs: it will ship this binary as a sidecar, inject `__ACTIONPAD_CONFIG__` with the bound `runtimeUrl`, and supervise the process.
