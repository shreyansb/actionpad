#!/usr/bin/env bash
set -euo pipefail

ACTIONPAD_VERSION="${ACTIONPAD_VERSION:-latest}"
ACTIONPAD_HOME="${ACTIONPAD_HOME:-$HOME/.actionpad}"
ACTIONPAD_RELEASE_BASE_URL="${ACTIONPAD_RELEASE_BASE_URL:-https://actionpad.theolabs.org}"
ACTIONPAD_TARBALL_URL="${ACTIONPAD_TARBALL_URL:-}"
ACTIONPAD_INSTALL_BIN="${ACTIONPAD_INSTALL_BIN:-$HOME/.local/bin}"
ACTIONPAD_WEB_PORT="${ACTIONPAD_WEB_PORT:-5110}"
ACTIONPAD_RUNTIME_PORT="${ACTIONPAD_RUNTIME_PORT:-5111}"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Actionpad install failed: %s\n' "$*" >&2
  printf 'Logs: %s\n' "$ACTIONPAD_HOME/logs" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

run_step() {
  log "-> $*"
  "$@" || fail "command failed: $*"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "Warning: this release is tested on macOS first."
fi

for command_name in curl tar node npm; do
  require_command "$command_name"
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -lt 20 ]]; then
  fail "Node 20 or newer is required; found $(node --version)"
fi

mkdir -p "$ACTIONPAD_HOME/versions" "$ACTIONPAD_HOME/logs" "$ACTIONPAD_HOME/run" "$ACTIONPAD_INSTALL_BIN"

base_url="${ACTIONPAD_RELEASE_BASE_URL%/}"
if [[ -n "$ACTIONPAD_TARBALL_URL" ]]; then
  tarball_url="$ACTIONPAD_TARBALL_URL"
elif [[ "$ACTIONPAD_VERSION" == "latest" ]]; then
  tarball_url="$base_url/actionpad.tar.gz"
else
  tarball_url="$base_url/actionpad-$ACTIONPAD_VERSION.tar.gz"
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

tarball="$tmp_dir/actionpad.tar.gz"
extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"

run_step curl -fsSL "$tarball_url" -o "$tarball"
run_step tar -xzf "$tarball" -C "$extract_dir"

package_dir="$extract_dir"
if [[ ! -f "$package_dir/package.json" ]]; then
  package_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 2 -name package.json -print -quit | xargs dirname)"
fi
[[ -f "$package_dir/package.json" ]] || fail "release tarball did not contain package.json"

release_version="$(cd "$package_dir" && node -p 'require("./package.json").version')"
version_dir="$ACTIONPAD_HOME/versions/$release_version"
if [[ -e "$version_dir" ]]; then
  version_dir="$ACTIONPAD_HOME/versions/$release_version-$(date +%Y%m%d%H%M%S)"
fi
installing_dir="$version_dir.installing"
rm -rf "$installing_dir"
mv "$package_dir" "$installing_dir"

run_step npm ci --prefix "$installing_dir"
run_step npm run build --prefix "$installing_dir"

if [[ ! -f "$ACTIONPAD_HOME/config.env" ]]; then
  cat >"$ACTIONPAD_HOME/config.env" <<EOF_CONFIG
ACTIONPAD_RUNTIME_PORT=$ACTIONPAD_RUNTIME_PORT
ACTIONPAD_WEB_PORT=$ACTIONPAD_WEB_PORT
ACTIONPAD_PROVIDER=codex
ACTIONPAD_CODEX_SANDBOX=workspace-write
ACTIONPAD_CODEX_APPROVAL=on-request
EOF_CONFIG
fi

mv "$installing_dir" "$version_dir"
ln -sfn "$version_dir" "$ACTIONPAD_HOME/current.next"
mv -f "$ACTIONPAD_HOME/current.next" "$ACTIONPAD_HOME/current"

launcher="$ACTIONPAD_INSTALL_BIN/actionpad"
cat >"$launcher" <<EOF_LAUNCHER
#!/usr/bin/env bash
exec "$ACTIONPAD_HOME/current/scripts/actionpad.mjs" "\$@"
EOF_LAUNCHER
chmod +x "$launcher"
chmod +x "$ACTIONPAD_HOME/current/scripts/actionpad.mjs" "$ACTIONPAD_HOME/current/scripts/serve-dist.mjs"

if [[ ":$PATH:" != *":$ACTIONPAD_INSTALL_BIN:"* ]]; then
  log "Add Actionpad to PATH:"
  log "  export PATH=\"$ACTIONPAD_INSTALL_BIN:\$PATH\""
fi

run_step "$launcher" doctor

log "Installed Actionpad."
log "Run: actionpad"
log "Diagnose: actionpad doctor"
log "Logs: ~/.actionpad/logs"
