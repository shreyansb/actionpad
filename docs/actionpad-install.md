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

## Publishing a Release

`npm run release:new -- <version>` updates package metadata, builds the release tarballs, and uploads the public installer files to the Cloudflare R2 bucket named `actionpad`.
The release upload uses `wrangler r2 object put --remote`; if Wrangler prints `Resource location: local`, it wrote to the local emulator instead of the Cloudflare bucket.

Before publishing for the first time:

```bash
npm install -g wrangler
wrangler login
wrangler r2 bucket create actionpad
```

Then configure the bucket's public or custom domain so `https://actionpad.theolabs.org/install.sh`, `https://actionpad.theolabs.org/actionpad.tar.gz`, and pinned URLs like `https://actionpad.theolabs.org/actionpad-v0.1.0.tar.gz` resolve from R2.

Publish a new release:

```bash
npm run release:new -- 0.1.7
```

Set `ACTIONPAD_R2_UPLOAD=0` to build the release locally without uploading, or `ACTIONPAD_R2_BUCKET=<bucket>` to publish to a different R2 bucket.
