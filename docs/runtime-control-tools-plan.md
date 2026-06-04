# Runtime Control Tools Plan

**Goal:** Let Actionpad agents safely request app refreshes and runtime lifecycle changes without killing active work.

**Architecture:** Split control from execution. The browser app can refresh on runtime events, but runtime start/stop/restart should be owned by an external supervisor so the agent is not stopping the process that hosts its own run. Background continuation requires persisted runtime events first, then durable run workers if runtime restarts must preserve active runs.

**Tech Stack:** React/Vite app, local Node runtime, WebSocket runtime events, Actionpad CLI/process helpers, Codex provider.

---

## Phase 1: Safe App Refresh

- Add a runtime event like `app-refresh-requested`.
- Have the browser subscribe through the existing runtime WebSocket.
- Refresh only at a safe point: immediately if no active run, otherwise after the current run completes.
- Test that a refresh request does not mark the run failed.

## Phase 2: Deferred Runtime Restart

- Add a supervisor/control plane outside `runtime/main.ts`.
- Move restart authority to that supervisor, reusing the existing PID/process helpers where possible.
- Add a runtime endpoint/tool request like `request-runtime-restart`.
- Default behavior: record pending restart, wait for active runs to finish, then restart runtime and let the browser reconnect.
- Treat immediate stop/restart as an approval-gated dangerous action.

## Phase 3: Event Replay For Browser Reconnects

- Persist runtime events in a small event journal keyed by run/thread.
- Add reconnect replay: browser sends last seen event id, runtime returns missed events.
- This makes browser refreshes safe even while a run is streaming.
- Test by disconnecting/reloading mid-run and confirming missed deltas, tool events, outline patch, and completion are applied once.

## Phase 4: Durable Background Runs

- Only needed if active work must survive runtime server restarts.
- Move each agent run into a durable worker/child process managed by the supervisor.
- Runtime server becomes a facade: start run, stream events, replay events, cancel run, report status.
- On runtime restart, reconnect to existing workers or replay terminal state from the journal.

## Recommendation

Start with Phase 1 and Phase 2. That gives agents practical `refresh` and `restart after this run` behavior without overbuilding. Add Phase 3 before relying on refresh during active streaming. Save Phase 4 until runtime restarts must preserve active agent execution.
