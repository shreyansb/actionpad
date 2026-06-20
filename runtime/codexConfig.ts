export type RuntimeProviderName = "fake" | "codex" | "claude"
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access"
export type CodexApprovalMode = "never" | "on-request" | "on-failure" | "untrusted"
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"
export type CodexWebSearchMode = "disabled" | "cached" | "live"
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max"
export type ClaudePermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan"
export type McpRuntimeProfile = "agent" | "admin"

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
  claude: {
    executable: string
    model?: string
    effort?: ClaudeEffort
    permissionMode: ClaudePermissionMode
    allowedTools: string[]
    disallowedTools: string[]
  }
  mcp: {
    enabled: boolean
    profile: McpRuntimeProfile
    runtimeUrl: string
    stdioCommand?: string
    stdioArgs?: string[]
    stdioCwd?: string
  }
}

const PROVIDERS = new Set<RuntimeProviderName>(["fake", "codex", "claude"])
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
const CLAUDE_EFFORT = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"])
const CLAUDE_PERMISSION_MODES = new Set<ClaudePermissionMode>([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
])

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

function readStringList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function readJsonStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed
    }
  } catch {
    return undefined
  }
  return undefined
}

export function parseRuntimeConfig(
  env: Record<string, string | undefined>,
  defaultWorkspace: string,
): RuntimeConfig {
  const provider = readEnum(
    env.ACTIONPAD_PROVIDER,
    PROVIDERS,
    "codex",
    "ACTIONPAD_PROVIDER must be fake, codex, or claude.",
  )!

  const port = Number(env.ACTIONPAD_RUNTIME_PORT ?? "5111")
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("ACTIONPAD_RUNTIME_PORT must be a positive integer.")
  }

  const runtimeUrl = env.ACTIONPAD_RUNTIME_URL ?? `http://127.0.0.1:${port}`

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
    claude: {
      executable: env.ACTIONPAD_CLAUDE_EXECUTABLE || "claude",
      model: env.ACTIONPAD_CLAUDE_MODEL || undefined,
      effort: readEnum(
        env.ACTIONPAD_CLAUDE_EFFORT,
        CLAUDE_EFFORT,
        undefined,
        "ACTIONPAD_CLAUDE_EFFORT must be low, medium, high, xhigh, or max.",
      ),
      permissionMode: readEnum(
        env.ACTIONPAD_CLAUDE_PERMISSION_MODE,
        CLAUDE_PERMISSION_MODES,
        "default",
        "ACTIONPAD_CLAUDE_PERMISSION_MODE must be acceptEdits, auto, bypassPermissions, default, dontAsk, or plan.",
      )!,
      allowedTools: readStringList(env.ACTIONPAD_CLAUDE_ALLOWED_TOOLS),
      disallowedTools: readStringList(env.ACTIONPAD_CLAUDE_DISALLOWED_TOOLS),
    },
    mcp: {
      enabled: env.ACTIONPAD_MCP_ENABLED !== "false",
      profile: env.ACTIONPAD_MCP_PROFILE === "admin" ? "admin" : "agent",
      runtimeUrl,
      stdioCommand: env.ACTIONPAD_MCP_STDIO_COMMAND || undefined,
      stdioArgs: readJsonStringArray(env.ACTIONPAD_MCP_STDIO_ARGS),
      stdioCwd: env.ACTIONPAD_MCP_STDIO_CWD || undefined,
    },
  }
}
