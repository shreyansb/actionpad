# Actionpad Runtime

Actionpad uses a local runtime process for executable bullets. The web app stays the viewer/editor; the runtime owns agent execution and streams events back over WebSocket.

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
ACTIONPAD_PROVIDER=codex npm run runtime:dev
```

The runtime listens on `http://127.0.0.1:43217`.

The web app reads the runtime URL from:

```bash
VITE_ACTIONPAD_RUNTIME_URL=http://127.0.0.1:43217
```

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
3. The side panel opens.
4. The runtime streams assistant and event output.
5. The final outline patch appends child bullets under the executed bullet.

## Troubleshooting

If the runtime is not running, Actionpad shows a failed run in the side panel with this message:

`Actionpad runtime is not running. Start the runtime and try again.`
