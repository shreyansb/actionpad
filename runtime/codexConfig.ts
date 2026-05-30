export type RuntimeProviderName = "fake" | "codex"
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access"
export type CodexApprovalMode = "never" | "on-request" | "on-failure" | "untrusted"
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"
export type CodexWebSearchMode = "disabled" | "cached" | "live"

export type RuntimeConfig = {
  provider: RuntimeProviderName
  port: number
  workspace: string
  codex: {
    model?: string
    reasoning?: CodexReasoningEffort
    sandbox: CodexSandboxMode
    approval: CodexApprovalMode
    network: boolean
    webSearch: CodexWebSearchMode
  }
}

const SANDBOXES = new Set<CodexSandboxMode>([
  "read-only",
  "workspace-write",
  "danger-full-access",
])
const APPROVALS = new Set<CodexApprovalMode>([
  "never",
  "on-request",
  "on-failure",
  "untrusted",
])
const REASONING = new Set<CodexReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"])
const WEB_SEARCH = new Set<CodexWebSearchMode>(["disabled", "cached", "live"])

function readEnum<T extends string>(
  value: string | undefined,
  allowed: Set<T>,
  fallback: T | undefined,
  message: string,
): T | undefined {
  if (value === undefined || value === "") return fallback
  if (allowed.has(value as T)) return value as T
  throw new Error(message)
}

function readBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1"
}

export function parseRuntimeConfig(
  env: Record<string, string | undefined>,
  defaultWorkspace: string,
): RuntimeConfig {
  const provider = env.ACTIONPAD_PROVIDER ?? "fake"
  if (provider !== "fake" && provider !== "codex") {
    throw new Error("ACTIONPAD_PROVIDER must be fake or codex.")
  }

  const port = Number(env.ACTIONPAD_RUNTIME_PORT ?? "43217")
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("ACTIONPAD_RUNTIME_PORT must be a positive integer.")
  }

  return {
    provider,
    port,
    workspace: env.ACTIONPAD_WORKSPACE || defaultWorkspace,
    codex: {
      model: env.ACTIONPAD_CODEX_MODEL || undefined,
      reasoning: readEnum(
        env.ACTIONPAD_CODEX_REASONING,
        REASONING,
        undefined,
        "ACTIONPAD_CODEX_REASONING must be minimal, low, medium, high, or xhigh.",
      ),
      sandbox: readEnum(
        env.ACTIONPAD_CODEX_SANDBOX,
        SANDBOXES,
        "workspace-write",
        "ACTIONPAD_CODEX_SANDBOX must be read-only, workspace-write, or danger-full-access.",
      )!,
      approval: readEnum(
        env.ACTIONPAD_CODEX_APPROVAL,
        APPROVALS,
        "on-request",
        "ACTIONPAD_CODEX_APPROVAL must be never, on-request, on-failure, or untrusted.",
      )!,
      network: readBoolean(env.ACTIONPAD_CODEX_NETWORK),
      webSearch: readEnum(
        env.ACTIONPAD_CODEX_WEB_SEARCH,
        WEB_SEARCH,
        "disabled",
        "ACTIONPAD_CODEX_WEB_SEARCH must be disabled, cached, or live.",
      )!,
    },
  }
}
