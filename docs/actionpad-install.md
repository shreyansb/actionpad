# Install Actionpad

Install the latest macOS-focused release:

```bash
curl -fsSL https://actionpad.theolabs.org/install.sh | bash
```

Install a specific version:

```bash
ACTIONPAD_VERSION=v0.1.0 curl -fsSL https://actionpad.theolabs.org/install.sh | bash
```

The installer downloads `https://actionpad.theolabs.org/actionpad.tar.gz` by default. For pinned installs, it downloads `https://actionpad.theolabs.org/actionpad-v0.1.0.tar.gz`. You can also force a direct tarball URL:

```bash
ACTIONPAD_TARBALL_URL=https://actionpad.theolabs.org/actionpad.tar.gz curl -fsSL https://actionpad.theolabs.org/install.sh | bash
```

The installer places Actionpad under `~/.actionpad`, writes the `actionpad` launcher to `~/.local/bin`, installs npm dependencies, and builds the local web app. A global `codex` command is not required; Actionpad uses the bundled `@openai/codex-sdk` package installed with the release.

Codex auth is still required. Open Codex once or configure Codex auth before running Actionpad tasks, then verify the install:

```bash
actionpad doctor
```

Daily commands:

```bash
actionpad
actionpad stop
actionpad restart
actionpad doctor
actionpad doctor --deep
```

Uninstall:

```bash
actionpad stop
rm -rf ~/.actionpad
rm -f ~/.local/bin/actionpad
```

Browser data is stored in IndexedDB for the app origin. Use Actionpad's in-app backup/import controls before changing ports or machines.
