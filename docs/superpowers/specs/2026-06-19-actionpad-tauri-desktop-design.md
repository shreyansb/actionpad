# Actionpad Tauri Desktop App — Design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan
**Scope:** Mac desktop app only, architected so hosted web and iPhone remain feasible later (each gets its own spec).

## Goal

Package Actionpad as a native macOS desktop app using Tauri 2. The desktop app
bundles and supervises the Actionpad runtime and MCP server locally. The runtime
is migrated from Node to Bun and compiled into a single self-contained sidecar
binary, so the app launches with no separate Node install and no `npm ci` step.

Web (self-hosted) and iPhone (self-hosted runtime) are explicit *future* targets.
They are not built in this effort, but the architecture must not foreclose them.

## Decisions (locked)

- **Shell:** Tauri 2 (Rust + system WKWebView). Chosen over Electron for size and
  because it serves bundled assets natively and supports iOS later.
- **Runtime packaging:** Bun, `bun build --compile` → single executable shipped as
  a Tauri `externalBin` sidecar. Committing to Bun now (no separate throwaway
  spike), but the Bun-compatibility smoke test is the *first* implementation step
  and gates the rest.
- **Audience (v1):** Just the author and a few testers. Unsigned local build.
  Apple signing + notarization is deferred and additive — it does not change the
  architecture.

## Current architecture (baseline)

Three Node processes supervised by `scripts/actionpad.mjs` via PID files:

| Process | Entry | Port (packaged / dev) | Role |
|---------|-------|-----------------------|------|
| runtime | `runtime/main.ts` (`node --import tsx`) | 5111 / 43217 | HTTP + WebSocket; runs agent providers (codex/claude/fake), streams `AgentRuntimeEvent` |
| web | `scripts/serve-dist.mjs` | 5110 / 5175 | static `dist/` server; injects `window.__ACTIONPAD_CONFIG__` |
| mcp | `runtime/mcp/httpMain.ts` (HTTP) / `stdioMain.ts` (stdio) | 5112 / 43218 | MCP tools (`request_app_refresh`, `request_runtime_restart`) |

- Frontend: Vite/React (`src/`), talks to runtime over HTTP + WebSocket via
  `src/runtimeClient/runtimeClient.ts`; runtime URL from injected config / env.
- Documents persist in browser **IndexedDB** (db `actionpad`, store `documents`);
  in-app backup/export to JSON exists.
- Codex provider spawns an MCP **stdio** subprocess per run
  (`node --import tsx runtime/mcp/stdioMain.ts`). Claude provider spawns the
  `claude` CLI. **Both the codex and claude CLIs are required regardless of how we
  package** — the app is never "zero external dependency."
- Distribution today: tarball → `~/.actionpad/versions/<v>` → `npm ci && build`,
  requires Node 20+.

## Target architecture (desktop)

Collapse 3 processes + PID supervisor into **1 native app + 1 sidecar binary**:

```
Actionpad.app  (Rust shell)
  ├─ WKWebView ── loads bundled frontend (dist/) via tauri:// asset protocol
  └─ supervises ▼
actionpad-runtime  (Bun-compiled sidecar)
  └─ runtime HTTP+WS on a localhost port (+ MCP, see below)
```

### Process & lifecycle model

- **Rust shell replaces `actionpad.mjs` as the desktop supervisor.** On launch it
  spawns the Bun sidecar, polls `/health`, then reveals the webview; on quit it
  tears the sidecar down. A single-instance guard prevents two windows contending
  for the port.
- **The `:5110` static web server is dropped for desktop.** Tauri serves `dist/`
  from its asset protocol. `scripts/serve-dist.mjs` stays in the repo untouched —
  it is the future hosted-web path.
- **The MCP server folds into the Bun sidecar.** The per-run MCP *stdio*
  subprocess is still spawned by the codex provider; the standalone MCP *HTTP*
  endpoint (5112) becomes a *mode* of the same binary, launched by the shell only
  when the external MCP endpoint is wanted.

What stays unchanged: runtime HTTP/WS protocol, the frontend runtime client,
IndexedDB persistence, and the **entire existing `actionpad.mjs` headless path**
(we add a desktop shell; we do not remove the server model — that is what keeps
web/iPhone feasible).

### Rejected alternative

Keep all 3 processes and have Tauri merely supervise them as today. Works, but
forfeits native asset serving and single-binary packaging — i.e. it would be
"Electron but lighter" and still ship Node + node_modules. Rejected.

## Bun runtime packaging

### Single multi-mode binary

The three entrypoints (`runtime/main.ts`, `runtime/mcp/stdioMain.ts`,
`runtime/mcp/httpMain.ts`) compile into **one binary with argv dispatch**:

```
actionpad-runtime              → runtime HTTP+WS server (default)
actionpad-runtime --mcp-stdio  → MCP stdio server
actionpad-runtime --mcp-http   → MCP HTTP server
```

**Critical detail — self-spawn for MCP stdio.** The codex provider today spawns
`node --import tsx runtime/mcp/stdioMain.ts`. In a compiled app there is no source
tree and no `tsx`, so the runtime must spawn **itself**
(`process.execPath --mcp-stdio`) for the per-run MCP subprocess. This is the main
reason for one multi-mode binary instead of three.

### Build & wiring

- `bun build --compile` → ~50MB self-contained binary (Bun engine embedded).
- Wired into Tauri as an `externalBin` sidecar with the required target-triple
  suffix (e.g. `actionpad-runtime-aarch64-apple-darwin`).
- `tsx` / `node --import tsx` is removed from the runtime path entirely.
- Size is roughly a wash vs bundling Node; the win is structural: one file, zero
  external runtime deps, no install-time build step.

## Frontend serving, config & persistence

- Tauri loads `dist/` from its asset protocol (origin `tauri://localhost`).
- The `window.__ACTIONPAD_CONFIG__` injection that `serve-dist.mjs` did is
  replaced by a **Tauri-injected global** carrying the provider **and the runtime
  URL/port the shell actually bound**. The frontend already supports a configurable
  base URL + config global, so the change is small.
- **Invariant that keeps web/iPhone cheap:** the frontend never hardcodes
  `localhost:5111`; it always reads the injected runtime URL.
- Config continuity: the shell keeps reading `~/.actionpad/config.env` (provider,
  sandbox/approval settings) and passes it to the sidecar via env, preserving the
  existing config and the headless path.

### macOS gotchas (planned, not to be discovered later)

1. **WKWebView + `ws://127.0.0.1`** — a `tauri://` origin connecting to a localhost
   WebSocket can be blocked by App Transport Security / CSP. Configure Tauri CSP
   (and an ATS loopback exception if needed) to allow it.
2. **IndexedDB durability** — docs live in the webview's IndexedDB. WKWebView
   persists this in the app data container across launches, but it is a different
   store than Safari, so first launch starts empty. The in-app backup/export is the
   migration path from the browser version.

## Dev & build workflow

- **Dev:** `bun run tauri dev` — Tauri `beforeDevCommand` starts Vite (5175) and the
  Bun runtime in dev mode (43217); the webview uses the Vite dev server for HMR
  while talking to the dev runtime. Replaces `dev-all.mjs` for desktop work;
  `dev:all` stays for browser-based development and the hosted-runtime dev loop.
- **Build:** `bun run tauri build` — `vite build` → `bun build --compile` sidecar →
  bundle into `Actionpad.app` + `.dmg`, unsigned. One-time right-click-open under
  Gatekeeper is acceptable for v1.
- **Signing/notarization:** deferred, additive (certs + CI signing pass), no
  architectural impact.

## Testing strategy

- **Existing Vitest suite (383 tests) stays on Node, unchanged** — the safety net
  for runtime/frontend logic; must stay green throughout the migration.
- **New Bun smoke test (first implementation step, gates everything):** the compiled
  binary boots, answers `/health`, completes a fake-provider run, and responds to an
  MCP call — exercised against the real `@openai/codex-sdk`, `ws`, and MCP SDK to
  settle the Bun-compatibility risk before any Tauri work begins.
- **Rust shell stays thin** (spawn, health-poll, teardown, single-instance);
  verified by a manual launch checklist: app opens → sidecar healthy → UI loads →
  run completes → quit kills sidecar.

## Risks (ranked)

1. **`@openai/codex-sdk` under Bun** (highest) — it spawns subprocesses; if it
   breaks, fallback is bundling Node instead, **same Tauri architecture**. Smoke
   test catches this on day one.
2. **WKWebView ATS/CSP blocking the localhost WebSocket** — solvable via Tauri CSP
   config; planned, not discovered.
3. **Self-spawn for MCP stdio** — compiled binary must relaunch itself correctly;
   covered by the smoke test.
4. **IndexedDB first-run-empty** in WKWebView — mitigated by backup/import.

## Future-proofing (designed-for, not built now)

- **Web (self-hosted):** host the same Bun binary as a server, point the frontend at
  it. Enabled by transport-agnostic runtime + injected runtime URL.
- **iPhone (self-hosted runtime):** Tauri 2 iOS shell + the hosted runtime.
- **Enforced now:** no hardcoded localhost in the frontend; runtime keeps its
  CORS/origin flexibility. Both are already nearly true today.

## Out of scope

- Building the hosted-web or iPhone targets.
- Apple signing / notarization / public distribution.
- Migrating the test runner to `bun test` (stays on Vitest/Node).
- Any change to the agent provider behavior or the outline/editor UX.
