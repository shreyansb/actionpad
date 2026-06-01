# Actionpad Release Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Actionpad so a friend on macOS can install it with one shell command, run it with `actionpad`, and diagnose prereq/auth/port problems with `actionpad doctor`.

**Architecture:** Keep Actionpad as a local web app plus local runtime. The installer downloads a versioned release tarball into `~/.actionpad/versions/<version>`, installs npm dependencies, builds the Vite app, creates a stable `actionpad` launcher, and starts the runtime plus a static web server on localhost. The doctor command verifies Node/npm, the bundled Codex SDK/native package, Codex auth files, configured ports, runtime health, and log paths.

**Tech Stack:** Bash installer, Node ESM launcher scripts, existing Vite build, existing Node runtime, `@openai/codex-sdk`, GitHub release tarballs, Vitest for helper tests, shell syntax checks for installer scripts.

---

## File Structure

```
scripts/
  actionpad.mjs               # User-facing CLI: start, stop, restart, open, doctor, status
  actionpadDoctor.mjs         # Pure-ish prereq and health checks for CLI + tests
  actionpadPaths.mjs          # Install/current/log/config/pid path helpers
  actionpadProcess.mjs        # Background process start/stop/status helpers
  create-release-tarball.mjs  # Builds local release artifact shape
  install.sh                  # One-line installer entrypoint
  serve-dist.mjs              # Static server for dist/ with SPA fallback
runtime/
  main.ts                     # Reuse existing runtime entrypoint
docs/
  actionpad-install.md        # Friend-facing install, update, doctor, uninstall notes
.github/workflows/
  release.yml                 # Build/test/package release artifact
package.json                  # Add release/start/doctor package scripts
```

---

## Design Decisions

- [ ] Keep the first release source-based, not a signed desktop app.
  - Install location: `~/.actionpad`.
  - Version location: `~/.actionpad/versions/<version>`.
  - Active version symlink: `~/.actionpad/current`.
  - Logs: `~/.actionpad/logs/runtime.log`, `~/.actionpad/logs/web.log`.
  - PID files: `~/.actionpad/run/runtime.pid`, `~/.actionpad/run/web.pid`.
  - User config: `~/.actionpad/config.env`.

- [ ] Do not require `codex` on the user's shell PATH.
  - Actionpad uses `@openai/codex-sdk`.
  - The SDK depends on the Codex npm package and resolves/spawns its packaged native binary from `node_modules`.
  - Doctor should explain this explicitly so `command -v codex` failing is not reported as an install failure.

- [ ] Require Codex auth/session readiness.
  - Check for `~/.codex/auth.json` or provider auth env accepted by the SDK.
  - Check `~/.codex/config.toml` when present, but do not require it.
  - Run an SDK smoke check only in `doctor --deep` because it may spend tokens and can prompt/fail for account reasons.

- [ ] Use stable default ports.
  - Runtime: `ACTIONPAD_RUNTIME_PORT=43217`.
  - Web: `ACTIONPAD_WEB_PORT=5175`.
  - The launcher should respect overrides from `~/.actionpad/config.env`.
  - Port checks should distinguish "Actionpad already running" from "another process owns the port".

---

## Task 1: Static Web Server For The Built App

- [ ] Add `scripts/serve-dist.mjs`.
  - Read `ACTIONPAD_WEB_PORT`, default `5175`.
  - Read `ACTIONPAD_HOST`, default `127.0.0.1`.
  - Serve files from `dist/`.
  - For unknown non-file routes, serve `dist/index.html` so the Vite SPA can load.
  - Return correct MIME types for `.html`, `.js`, `.css`, `.json`, `.svg`, `.png`, `.ico`, `.map`, `.woff`, and `.woff2`.
  - Log one machine-readable line on startup:

    ```text
    Actionpad web listening at http://127.0.0.1:5175
    ```

- [ ] Add package scripts.

  ```json
  {
    "scripts": {
      "web:start": "node scripts/serve-dist.mjs",
      "actionpad": "node scripts/actionpad.mjs",
      "actionpad:doctor": "node scripts/actionpad.mjs doctor"
    }
  }
  ```

- [ ] Add tests for the static server helpers.
  - MIME lookup returns expected content types.
  - Path resolution prevents `..` traversal outside `dist/`.
  - SPA fallback returns `index.html` for extensionless missing paths.

---

## Task 2: CLI Path And Process Helpers

- [ ] Add `scripts/actionpadPaths.mjs`.
  - Export `getActionpadHome(env)`.
  - Default home to `~/.actionpad`.
  - Export paths for `current`, `versions`, `logs`, `run`, `config.env`, runtime log, web log, runtime PID, and web PID.
  - Allow tests to override home with `ACTIONPAD_HOME`.

- [ ] Add `scripts/actionpadProcess.mjs`.
  - Export `readPidFile`, `isProcessAlive`, `removeStalePidFile`, `waitForHttpOk`, `startBackgroundProcess`, `stopPidFileProcess`, and `getPortOwnerHint`.
  - `startBackgroundProcess` should:
    - create parent directories,
    - append stdout/stderr to the requested log file,
    - write the child PID after successful spawn,
    - detach the child so the launcher can exit.
  - `stopPidFileProcess` should:
    - send `SIGTERM`,
    - wait up to 5 seconds,
    - send `SIGKILL` only when the process is still alive,
    - remove stale PID files.

- [ ] Add tests for helper behavior.
  - Missing PID files report "not running".
  - Dead PID files are removed.
  - `waitForHttpOk` succeeds on a temporary test server and times out cleanly for an unused port.

---

## Task 3: User-Facing `actionpad` CLI

- [ ] Add `scripts/actionpad.mjs`.
  - Supported commands:
    - `actionpad` -> `start --open`
    - `actionpad start` -> start runtime and web if needed, then print URL
    - `actionpad start --open` -> start then open browser
    - `actionpad stop` -> stop web and runtime
    - `actionpad restart` -> stop then start
    - `actionpad open` -> open current web URL without restarting healthy processes
    - `actionpad status` -> print runtime/web process and health status
    - `actionpad doctor` -> run normal checks
    - `actionpad doctor --deep` -> include SDK smoke run
  - Unknown commands should print concise usage and exit nonzero.

- [ ] Load config in this order.
  - Defaults from CLI code.
  - `~/.actionpad/config.env`.
  - Current shell environment.
  - Explicit CLI flags, when present.

- [ ] Start behavior.
  - Refuse to start if no `dist/index.html` exists; print `Run npm run build or reinstall Actionpad.`.
  - Start runtime with `npm run runtime:start` from `~/.actionpad/current`.
  - Start web with `npm run web:start` from `~/.actionpad/current`.
  - Wait for `GET /health` on the runtime.
  - Wait for `GET /` on the web server.
  - Print:

    ```text
    Actionpad is running:
      app:     http://127.0.0.1:5175
      runtime: http://127.0.0.1:43217/health
      logs:    ~/.actionpad/logs
    ```

- [ ] Stop behavior.
  - Stop web before runtime.
  - Treat already-stopped processes as success.
  - Print which PID files were stale and removed.

- [ ] Browser open behavior.
  - On macOS, use `open http://127.0.0.1:<port>`.
  - On non-macOS, print the URL and skip automatic opening for this release.

---

## Task 4: Doctor Checks

- [ ] Add `scripts/actionpadDoctor.mjs`.
  - Export `runDoctorChecks(options)` returning structured results:

    ```ts
    type DoctorResult = {
      id: string
      label: string
      status: "pass" | "warn" | "fail"
      detail: string
    }
    ```

- [ ] Implement normal checks.
  - Platform:
    - pass on `darwin`,
    - warn on other platforms with `This release is tested on macOS first.`
  - Node:
    - pass for major version `>=20`,
    - fail below 20.
  - npm:
    - fail when `npm --version` cannot run.
  - install paths:
    - fail if `~/.actionpad/current/package.json` is missing.
    - fail if `~/.actionpad/current/node_modules/@openai/codex-sdk` is missing.
  - Codex bundled package:
    - pass if `@openai/codex-sdk` can be imported.
    - pass if the package dependency tree includes `@openai/codex` or an SDK-resolved Codex binary path can be found.
    - warn, not fail, when `command -v codex` fails; detail should say the global CLI is not required.
  - Codex auth:
    - pass when `~/.codex/auth.json` exists.
    - warn when missing, with `Open Codex once or configure Codex auth before running Actionpad tasks.`
  - ports:
    - pass when runtime/web ports are free or already owned by healthy Actionpad processes.
    - fail when another process owns a required port.
  - runtime health:
    - pass when `GET /health` succeeds.
    - warn when runtime is stopped.
    - fail when PID exists but `/health` does not respond.
  - logs:
    - pass when log directory is writable.

- [ ] Implement deep checks.
  - Construct the Codex SDK client from the installed dependency.
  - Run a tiny provider smoke only when `--deep` is passed.
  - The smoke prompt should be explicit that it must not edit files:

    ```text
    Reply with exactly: actionpad doctor ok
    ```

  - Treat auth/model/network errors as actionable failures with the first useful error line.

- [ ] CLI output format.
  - Use plain ASCII symbols:
    - `[pass]`
    - `[warn]`
    - `[fail]`
  - Exit `0` when there are no failures.
  - Exit `1` when one or more checks fail.

---

## Task 5: Installer Script

- [ ] Add `scripts/install.sh`.
  - Use strict mode:

    ```bash
    set -euo pipefail
    ```

  - Support environment overrides:
    - `ACTIONPAD_VERSION`, default `latest`.
    - `ACTIONPAD_HOME`, default `$HOME/.actionpad`.
    - `ACTIONPAD_RELEASE_BASE_URL`, default to the GitHub releases URL for this repo.
    - `ACTIONPAD_INSTALL_BIN`, default `$HOME/.local/bin`.
    - `ACTIONPAD_WEB_PORT`, default `5175`.
    - `ACTIONPAD_RUNTIME_PORT`, default `43217`.

- [ ] Installer steps.
  - Check macOS and print a warning on other platforms.
  - Check `curl`, `tar`, `node`, and `npm`.
  - Require Node major version `>=20`.
  - Create `~/.actionpad/{versions,logs,run}` and `~/.local/bin`.
  - Resolve the release tarball URL:
    - `latest` -> `<base>/latest/download/actionpad.tar.gz`.
    - explicit version -> `<base>/download/<version>/actionpad.tar.gz`.
  - Download to a temp file.
  - Extract into `~/.actionpad/versions/<version-or-release-manifest-version>`.
  - Run `npm ci` from the extracted directory.
  - Run `npm run build`.
  - Write `~/.actionpad/config.env` when it does not exist:

    ```bash
    ACTIONPAD_RUNTIME_PORT=43217
    ACTIONPAD_WEB_PORT=5175
    ACTIONPAD_PROVIDER=codex
    ACTIONPAD_CODEX_SANDBOX=workspace-write
    ACTIONPAD_CODEX_APPROVAL=on-request
    ```

  - Update `~/.actionpad/current` symlink atomically.
  - Write launcher shim at `$ACTIONPAD_INSTALL_BIN/actionpad`:

    ```bash
    #!/usr/bin/env bash
    exec "$HOME/.actionpad/current/scripts/actionpad.mjs" "$@"
    ```

  - Mark launcher executable.
  - Run `~/.local/bin/actionpad doctor`.
  - Print final usage:

    ```text
    Installed Actionpad.
    Run: actionpad
    Diagnose: actionpad doctor
    Logs: ~/.actionpad/logs
    ```

- [ ] Installer failure behavior.
  - Never delete an existing working `~/.actionpad/current` when a new install fails.
  - Leave failed extraction under a temp directory and remove it on exit.
  - Print the log path and failing command.
  - If `$ACTIONPAD_INSTALL_BIN` is not on PATH, print the exact shell line to add it.

- [ ] Add syntax verification.
  - `bash -n scripts/install.sh`
  - `shellcheck scripts/install.sh` when `shellcheck` is available; otherwise document that the command was skipped.

---

## Task 6: Release Tarball Script And Workflow

- [ ] Add `scripts/create-release-tarball.mjs`.
  - Run `npm ci`.
  - Run `npm test -- src`.
  - Run `npm run lint`.
  - Run `npm run build`.
  - Create `release/actionpad.tar.gz`.
  - Include:
    - `package.json`
    - `package-lock.json`
    - `index.html`
    - `dist/`
    - `runtime/`
    - `scripts/`
    - `src/runtimeClient/` only if TypeScript compilation still needs it
    - `tsconfig*.json`
    - `vite.config.*`
    - `docs/actionpad-install.md`
  - Exclude:
    - `node_modules/`
    - `.git/`
    - local backups
    - test output
    - `.env`
    - `~/.codex` data

- [ ] Add `.github/workflows/release.yml`.
  - Trigger on tags matching `v*`.
  - Use macOS runner first because this release targets friends on macOS.
  - Install Node 20.
  - Run:

    ```bash
    npm ci
    npm test -- src
    npm run lint
    npm run build
    node scripts/create-release-tarball.mjs
    ```

  - Upload `release/actionpad.tar.gz` as a GitHub release asset.

- [ ] Add a local release dry run command.

  ```json
  {
    "scripts": {
      "release:pack": "node scripts/create-release-tarball.mjs"
    }
  }
  ```

---

## Task 7: Friend-Facing Docs

- [ ] Add `docs/actionpad-install.md`.
  - Include the one-line install command:

    ```bash
    curl -fsSL https://raw.githubusercontent.com/shreyans/actionpad/main/scripts/install.sh | bash
    ```

  - Include install-with-version:

    ```bash
    ACTIONPAD_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/shreyans/actionpad/main/scripts/install.sh | bash
    ```

  - Explain that a global `codex` command is not required.
  - Explain that Codex auth is still required.
  - Include daily commands:

    ```bash
    actionpad
    actionpad stop
    actionpad restart
    actionpad doctor
    actionpad doctor --deep
    ```

  - Include uninstall:

    ```bash
    actionpad stop
    rm -rf ~/.actionpad
    rm -f ~/.local/bin/actionpad
    ```

  - Include backup/migration note:
    - Browser data is stored in IndexedDB for the app origin.
    - Use Actionpad's in-app backup/import controls before changing ports or machines.

---

## Task 8: Verification

- [ ] Unit and integration tests.
  - `npm test -- src`
  - `npm run runtime:test`
  - Node script tests for:
    - path helpers,
    - doctor result formatting,
    - static server path safety,
    - PID helper stale-file handling.

- [ ] Build and static checks.
  - `npm run lint`
  - `npm run build`
  - `bash -n scripts/install.sh`
  - `node scripts/create-release-tarball.mjs`
  - `git diff --check`

- [ ] Manual smoke on a macOS machine with network access.
  - Remove any prior test install:

    ```bash
    actionpad stop || true
    rm -rf ~/.actionpad-test ~/.local/bin/actionpad-test
    ```

  - Install into an isolated home:

    ```bash
    ACTIONPAD_HOME="$HOME/.actionpad-test" \
    ACTIONPAD_INSTALL_BIN="$HOME/.local/bin" \
    ACTIONPAD_WEB_PORT=5176 \
    ACTIONPAD_RUNTIME_PORT=43218 \
    bash scripts/install.sh
    ```

  - Run:

    ```bash
    ACTIONPAD_HOME="$HOME/.actionpad-test" ~/.local/bin/actionpad doctor
    ACTIONPAD_HOME="$HOME/.actionpad-test" ~/.local/bin/actionpad start
    ACTIONPAD_HOME="$HOME/.actionpad-test" ~/.local/bin/actionpad status
    ACTIONPAD_HOME="$HOME/.actionpad-test" ~/.local/bin/actionpad stop
    ```

- [ ] Acceptance criteria.
  - A fresh macOS user with Node 20/npm and Codex auth can install with one command.
  - `actionpad` starts runtime and web without needing a repo checkout.
  - `command -v codex` may fail while `actionpad doctor` still passes the bundled Codex checks.
  - Busy ports produce a clear failure with the configured port number.
  - Logs and PID files are under `~/.actionpad`.
  - Existing working install survives a failed attempted update.

---

## Out Of Scope For This Plan

- [ ] Signed `.app` bundle and notarization.
- [ ] Homebrew tap.
- [ ] npm global package.
- [ ] Automatic background updates.
- [ ] Moving browser IndexedDB data into a runtime-owned database.
