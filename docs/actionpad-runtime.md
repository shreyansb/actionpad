# Actionpad Runtime

Actionpad uses a local runtime process for executable bullets. The web app stays the viewer/editor; the runtime owns agent execution and streams events back over WebSocket.

## Development

Start the web app:

```bash
npm run dev
```

Start the web app and runtime together:

```bash
npm run dev:all
```

Start the runtime with the deterministic fake provider:

```bash
ACTIONPAD_PROVIDER=fake npm run runtime:dev
```

Start the runtime with Codex, which is the default provider:

```bash
npm run runtime:dev
```

`runtime:dev` watches runtime source files and restarts automatically on code changes. Use `npm run runtime:start` when you want the same runtime without file watching.

The runtime listens on `http://127.0.0.1:43217`.

The web app reads the runtime URL from:

```bash
VITE_ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217
```

## Real Codex Provider

Start the runtime with local Codex SDK execution:

```bash
npm run runtime:dev
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

`ACTIONPAD_WORKSPACE` controls where Codex runs. If it is not set, the runtime uses the current working directory.

Safety defaults are conservative:

```text
ACTIONPAD_CODEX_SANDBOX=workspace-write
ACTIONPAD_CODEX_APPROVAL=on-request
ACTIONPAD_CODEX_NETWORK=false
ACTIONPAD_CODEX_WEB_SEARCH=disabled
```

The runtime uses local Codex authentication. Automated tests use mocked Codex clients and do not require credentials.

For a smoke test, create or focus a bullet such as:

```text
Create two child bullets about why Actionpad should stay outline-first.
```

Press `Cmd+Enter`. A successful run should stream assistant output and append child bullets if Codex emits a valid Actionpad output block.

## Expected Flow

1. Focus a bullet.
2. Press `Cmd+Enter`.
3. The run starts in the background and the row shows a spinner.
4. Press `Cmd+Enter` again on a bullet with an existing chat to open the side panel.
5. The runtime streams assistant and event output.
6. The final outline patch can append nested child bullets, edit bullet text, delete bullets, or apply a batch of those operations.
7. Send a follow-up in the chat panel to start another run on the same bullet thread with the current outline snapshot.

## Runtime Control

The browser UI uses direct runtime HTTP for safe lifecycle controls:

```text
POST /app/refresh
POST /runtime/restart
```

`POST /app/refresh` broadcasts an `app-refresh-requested` event over the runtime WebSocket. The browser reloads immediately if no run is active, or waits until the current active runs finish.

`POST /runtime/restart` records a deferred restart request. If runs are active, the runtime waits for them to finish before calling the external `runtimeController.requestRestart` hook. Immediate stop or restart remains outside this endpoint.

## Actionpad MCP Server

Actionpad agents use MCP tools for runtime controls. Browser UI controls still use the direct runtime HTTP endpoints above.

Codex-backed Actionpad runs get the local stdio MCP server automatically through Codex config when MCP is enabled, which is the default. Set `ACTIONPAD_MCP_ENABLED=false` to disable that wiring.

For development or client-launched sessions where Codex or another MCP client owns stdio, run the foreground stdio server:

```bash
npm run mcp:start
```

This is not a background daemon.

For manual/admin clients and diagnostics, manage the localhost Streamable HTTP MCP server with:

```bash
actionpad mcp start
actionpad mcp stop
actionpad mcp restart
actionpad mcp status
```

This is separate from `actionpad start`. `actionpad start` starts the web app and runtime, not MCP.

Default managed HTTP endpoints:

```text
http://127.0.0.1:43218/mcp
http://127.0.0.1:43218/health
```

Initial tools:

- `request_app_refresh`: asks the browser app to refresh at a safe point. It is rate-limited and does not require approval.
- `request_runtime_restart`: requests a deferred runtime restart. The `agent` profile requires `userIntent` to be `explicit_user_request` or `runtime_changes_need_reload`; the tool does not kill the process directly.

Profiles and policy:

- `agent` is the default for Codex-launched stdio MCP.
- `admin` is the default for managed CLI HTTP MCP.
- Unknown profiles fail closed.

Useful environment variables:

```bash
ACTIONPAD_MCP_ENABLED=true
ACTIONPAD_MCP_PROFILE=agent
ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217
ACTIONPAD_MCP_HOST=127.0.0.1
ACTIONPAD_MCP_PORT=43218
ACTIONPAD_MCP_AUDIT_LOG=/path/to/actionpad-mcp-audit.jsonl
```

## Troubleshooting

If the runtime is not running, Actionpad shows a failed run in the side panel with this message:

`Actionpad runtime is not running. Start the runtime and try again.`

If MCP tools do not appear in a Codex-backed run, check that `ACTIONPAD_MCP_ENABLED` is not `false`, the run is using the Codex provider, and the runtime URL points at the active runtime.

For managed HTTP MCP, run `actionpad mcp status` and check the MCP log printed by `actionpad mcp start`. The default health check is `http://127.0.0.1:43218/health`.
