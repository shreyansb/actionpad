# Actionpad Local MCP Server Design

## Goal

Add a local Actionpad MCP server as the first-class tool surface for Actionpad agents. The first two tools will expose the existing runtime control requests:

- `request_app_refresh`
- `request_runtime_restart`

The design should make these tools safe enough for the current local desktop prototype and extensible enough for future Actionpad tools such as outline search, outline edits, current document context, and runtime status.

## Context

Actionpad already has HTTP runtime control endpoints:

- `POST /app/refresh`
- `POST /runtime/restart`

These endpoints are useful internal transport, but they are not an agent tool interface. The browser can call them through `ActionpadRuntimeClient`, but the Codex-backed Actionpad agent does not automatically know about them, does not receive typed schemas for them, and does not have policy guidance for when they are appropriate.

MCP is a good fit for the agent-facing boundary because MCP tools are discoverable through `tools/list`, invoked through `tools/call`, and described with JSON Schema. The MCP tools specification also treats tools as model-controlled and recommends human-visible tool exposure and confirmation for sensitive operations. MCP authorization is optional, and the HTTP authorization specification is OAuth-oriented; for local stdio transports, the specification says implementations should retrieve credentials from the environment instead of using that OAuth flow.

References:

- MCP tools specification: `https://modelcontextprotocol.io/specification/2025-06-18/server/tools`
- MCP authorization specification: `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`

## Non-Goals

- Do not expose immediate runtime stop, immediate runtime restart, process kill, shell execution, or arbitrary HTTP fetch as MCP tools.
- Do not make the MCP server remote or multi-user in this phase.
- Do not add OAuth in this phase.
- Do not move browser UI controls to MCP; browser controls should continue using direct runtime HTTP through `ActionpadRuntimeClient`.
- Do not add outline read/write MCP tools in this phase. The server should be shaped so those tools can be added later.

## Architecture

Add a local stdio MCP server process owned by Actionpad. The Codex runtime config will launch or connect to this MCP server so the Actionpad agent sees a small set of named tools.

The MCP server will be a thin policy and schema layer over existing runtime HTTP endpoints:

```text
Codex agent
  -> MCP client configured by Codex runtime
    -> Actionpad MCP server over stdio
      -> Actionpad runtime HTTP endpoint on 127.0.0.1
        -> runtime WebSocket event to browser
```

The MCP server should not duplicate runtime state. It should call the runtime using a configured base URL, defaulting to `http://127.0.0.1:43217`.

The Actionpad runtime remains the owner of run state and active-run deferral. The MCP server owns:

- Tool names and schemas.
- Caller profile policy.
- Tool call authorization checks.
- Tool call result shaping.
- Audit logging for tool calls.

## Transport Decision

Use stdio MCP first.

Reasons:

- Actionpad is currently local-first.
- The agent runtime already runs locally.
- Local stdio avoids adding HTTP auth/OAuth machinery before there is a remote or multi-user deployment.
- Different caller profiles can be expressed by launching the MCP server with different env/config.

HTTP MCP can be added later if Actionpad grows remote clients or multi-user usage. At that point, the server should use OAuth-style bearer tokens and scopes per the MCP authorization spec.

## MCP Server Entrypoints

Add a package-script entrypoint for development and a user-facing Actionpad CLI command for installed/local service workflows.

Development entrypoint:

```bash
npm run mcp:start
```

The script should run a Node module such as:

```text
runtime/mcp/main.ts
```

CLI entrypoints:

```bash
actionpad mcp start
actionpad mcp stop
actionpad mcp restart
actionpad mcp status
```

`actionpad mcp start` should start a background MCP server process using the same PID/log conventions as the existing runtime and web server helpers. `actionpad mcp stop` should stop only the MCP server. `actionpad mcp restart` should stop and start only the MCP server. `actionpad mcp status` should report PID and responsiveness where possible.

`actionpad start` should continue starting the web app and runtime. It should not start the MCP server by default in the first implementation unless the Codex runtime wiring requires a separately managed MCP process. If the Codex runtime can launch the MCP server as a stdio child directly, then `actionpad mcp start` is primarily for manual/admin MCP clients and diagnostics.

Configuration:

```text
ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217
ACTIONPAD_MCP_PROFILE=agent
ACTIONPAD_MCP_AUDIT_LOG=
```

Defaults:

- `ACTIONPAD_RUNTIME_URL`: `http://127.0.0.1:43217`
- `ACTIONPAD_MCP_PROFILE`: `agent`
- `ACTIONPAD_MCP_AUDIT_LOG`: unset means log to stderr only

## Profiles And Permissions

Profiles define which tools are advertised and which calls are authorized. Tool visibility and call-time authorization must both be enforced.

### `agent` Profile

Default profile used by the Actionpad Codex agent.

Advertised tools:

- `request_app_refresh`
- `request_runtime_restart`

Permissions:

- Can call `request_app_refresh` without approval.
- Can call `request_runtime_restart` only when the call arguments declare an allowed `userIntent`.
- The `userIntent` argument is a guardrail and audit signal, not proof of user approval. A stronger host-issued approval token can be added later, but is not part of this phase.

### `admin` Profile

Reserved for local developer/admin clients.

Advertised tools:

- `request_app_refresh`
- `request_runtime_restart`
- Future non-destructive status and diagnostic tools.

Permissions:

- Can call deferred restart without explicit task-level user intent.
- Still cannot call immediate stop/restart because those tools do not exist in this phase.

### Unknown Profiles

Unknown profile values must fail closed:

- `tools/list` returns no tools.
- `tools/call` rejects all tool calls with an MCP tool error result.

## Tool Definitions

### `request_app_refresh`

Description:

> Request that the Actionpad browser app refresh at a safe point. The browser refreshes immediately if no agent run is active, or after active runs finish.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "description": "Short reason for requesting the app refresh."
    }
  },
  "required": ["reason"],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "requested": { "type": "boolean" },
    "runtimeUrl": { "type": "string" }
  },
  "required": ["requested", "runtimeUrl"],
  "additionalProperties": false
}
```

Behavior:

- MCP server sends `POST /app/refresh`.
- On HTTP 202, returns `requested: true`.
- On non-2xx response or fetch failure, returns `isError: true` with a concise error message.

Approval policy:

- No approval required.
- Rate-limit to one successful request per MCP server process every 2 seconds.
- If called too frequently, return a successful no-op result with `requested: false` once the output schema is extended to support that value. In the first implementation, prefer a tool error result so the schema remains simple.

### `request_runtime_restart`

Description:

> Request a deferred Actionpad runtime restart. The runtime records the request and waits for active runs to finish before delegating to an external supervisor.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "description": "Short reason for requesting the runtime restart."
    },
    "userIntent": {
      "type": "string",
      "enum": ["explicit_user_request", "runtime_changes_need_reload"],
      "description": "Why this restart is allowed for the current task."
    }
  },
  "required": ["reason", "userIntent"],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "requested": { "type": "boolean" },
    "pending": { "type": "boolean" },
    "runtimeUrl": { "type": "string" }
  },
  "required": ["requested", "pending", "runtimeUrl"],
  "additionalProperties": false
}
```

Behavior:

- MCP server checks profile policy before calling the runtime.
- MCP server sends `POST /runtime/restart`.
- On HTTP 202, returns the runtime response fields `requested` and `pending`.
- The tool never performs process control directly.
- The runtime restart only happens if the runtime was started with a supervisor-provided `runtimeController.requestRestart` hook.

Approval policy:

- `agent` profile requires `userIntent`.
- `admin` profile still requires `reason`, but may use `userIntent: "explicit_user_request"` for local manual calls.
- Immediate restart is out of scope and must not be approximated by calling shell commands or killing processes.
- If the user did not ask for a runtime restart and the current task did not change runtime/server/provider/MCP-tool code, the agent must not call this tool.

## Prompt Updates

Update the Actionpad base prompt so the agent knows the tools exist and when to use them.

Add a section like:

```text
Actionpad runtime tools:

- Use request_app_refresh after you complete frontend, styling, browser-runtime, or UI-facing changes and the user would benefit from seeing the updated app. Also use it when the user explicitly asks you to refresh or reload the Actionpad app. Do not call it repeatedly; one request after the completed change is enough.

- Use request_runtime_restart only when the user explicitly asks to restart/reload the runtime, or when you changed runtime/server/provider/MCP-tool code and those changes cannot be used until the runtime process reloads. This tool requests a deferred restart; it must not kill the active run. Do not use shell commands to stop or restart Actionpad from inside an active Actionpad run.

Prefer request_app_refresh when a browser refresh is enough. Use request_runtime_restart only when runtime process code or tool registration changed.
```

The prompt should not include raw `curl` commands for these controls. The agent should prefer MCP tools.

## Codex Runtime Integration

The current installed `@openai/codex-sdk` README documents streaming, thread options, config overrides, and CLI environment control, but does not document a direct custom function registration API. The implementation should therefore include a short integration spike:

1. Confirm how the Codex CLI accepts MCP server configuration through SDK `config` overrides, runtime config files, or environment.
2. Prefer configuring the Actionpad MCP server as a local stdio MCP server.
3. Keep the MCP server implementation independent of Codex-specific APIs so future providers can reuse it.

If direct native tool registration becomes available and is simpler than MCP, this design should still proceed with MCP because Actionpad expects to expose more tools through the same server soon.

## Error Handling

MCP protocol errors should be reserved for malformed MCP requests or server failures before tool dispatch.

Tool execution failures should return MCP tool results with `isError: true`, per MCP schema guidance:

- Runtime offline.
- Runtime returns non-2xx.
- Unknown profile.
- Tool not allowed for profile.
- Restart call lacks required user intent.
- Rate-limit rejection.

Error text should be concise and safe to show in the chat timeline.

## Audit Logging

Every tool call should produce a local audit entry:

```json
{
  "timestamp": 1780000000000,
  "profile": "agent",
  "tool": "request_app_refresh",
  "arguments": { "reason": "frontend styles changed" },
  "allowed": true,
  "runtimeUrl": "http://127.0.0.1:43217",
  "outcome": "requested"
}
```

Audit logs should not include assistant hidden reasoning or full prompts.

If `ACTIONPAD_MCP_AUDIT_LOG` is set, append newline-delimited JSON to that file. Otherwise, write concise logs to stderr.

## Testing Strategy

### Unit Tests

Add tests for:

- Tool registry returns only profile-allowed tools.
- Unknown profile exposes no tools and denies calls.
- `request_app_refresh` calls `/app/refresh`.
- `request_runtime_restart` calls `/runtime/restart`.
- Restart is denied for `agent` profile when `userIntent` is missing or invalid.
- Runtime HTTP failures become `isError: true` tool results.
- Audit entries are written for allowed and denied calls.

### Integration Tests

Add a node-environment test that starts the MCP server against a fake runtime HTTP server and sends JSON-RPC:

- `initialize`
- `tools/list`
- `tools/call` for `request_app_refresh`
- `tools/call` for `request_runtime_restart`

The test should assert MCP response shape, tool schemas, and fake runtime request paths.

### Prompt Tests

Add tests around `buildActionpadPrompt` or its extracted equivalent:

- Prompt mentions `request_app_refresh`.
- Prompt mentions `request_runtime_restart`.
- Prompt says app refresh is preferred for browser/UI changes.
- Prompt says runtime restart is deferred and should not be emulated with shell process control.

## Documentation

Update `docs/actionpad-runtime.md` with:

- How to start, stop, restart, and inspect the MCP server with `actionpad mcp start`, `actionpad mcp stop`, `actionpad mcp restart`, and `actionpad mcp status`.
- How to run the development entrypoint with `npm run mcp:start`.
- How the Codex runtime is configured to use it.
- The initial tool list.
- Safety rules and profile behavior.

Add an internal note that browser controls still use direct HTTP and agent controls use MCP.

## Rollout

1. Implement MCP server with profile-aware tool registry and fake runtime tests.
2. Add the development entrypoint `npm run mcp:start`.
3. Add `actionpad mcp start`, `actionpad mcp stop`, `actionpad mcp restart`, and `actionpad mcp status`.
4. Add the two runtime control tools.
5. Wire Codex runtime to expose the MCP server.
6. Update the base prompt.
7. Verify in dev by asking the Actionpad agent to request an app refresh after a UI change.
8. Add deferred restart supervisor wiring only after MCP tool exposure is proven.

## Acceptance Criteria

- `npm run mcp:start` starts a local Actionpad MCP server.
- `actionpad mcp start` starts the local MCP server as a managed background process.
- `actionpad mcp stop` stops the managed MCP server without stopping the web app or runtime.
- `actionpad mcp restart` restarts only the managed MCP server.
- `actionpad mcp status` reports whether the managed MCP server is running.
- `agent` profile lists exactly `request_app_refresh` and `request_runtime_restart`.
- `tools/call request_app_refresh` reaches `POST /app/refresh`.
- `tools/call request_runtime_restart` reaches `POST /runtime/restart` only when policy allows it.
- Codex-backed Actionpad runs see the tools as named tools rather than relying on raw HTTP or shell commands.
- The Actionpad base prompt tells the agent when to use each tool.
- Tests cover registry policy, tool call behavior, prompt guidance, and runtime HTTP failures.
- No immediate stop/restart/process-kill tool exists.

## Self-Review

Placeholder scan: no `TBD`, `TODO`, or unspecified implementation sections remain.

Internal consistency: the design consistently treats HTTP as internal transport and MCP as the agent-facing tool interface. Browser controls remain direct HTTP clients.

Scope check: this is focused on a local MCP server plus two starter tools. Future outline tools are named only as motivation and are not part of this implementation.

Ambiguity check: permissions are profile-based, enforced at both `tools/list` and `tools/call`, and restart safety is explicitly deferred-only with no immediate process-control tool.
