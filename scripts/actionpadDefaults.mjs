export const ACTIONPAD_DEV_PORTS = {
  runtimePort: 43217,
  webPort: 5175,
}

export const ACTIONPAD_PACKAGED_PORTS = {
  runtimePort: 5111,
  webPort: 5110,
}

export function getActionpadDevPorts() {
  return { ...ACTIONPAD_DEV_PORTS }
}

export function getActionpadDefaultConfig() {
  return {
    ACTIONPAD_HOST: "127.0.0.1",
    ACTIONPAD_RUNTIME_PORT: String(ACTIONPAD_PACKAGED_PORTS.runtimePort),
    ACTIONPAD_WEB_PORT: String(ACTIONPAD_PACKAGED_PORTS.webPort),
    ACTIONPAD_PROVIDER: "codex",
    ACTIONPAD_CODEX_SANDBOX: "workspace-write",
    ACTIONPAD_CODEX_APPROVAL: "on-request",
  }
}
