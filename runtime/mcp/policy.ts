import {
  actionpadMcpToolNames,
  type ActionpadMcpDecision,
  type ActionpadMcpProfile,
  type ActionpadMcpToolName,
} from "./types"

export type RuntimeRestartUserIntent = "explicit_user_request" | "runtime_changes_need_reload"

const visibleToolsByProfile: Record<ActionpadMcpProfile, ActionpadMcpToolName[]> = {
  agent: [...actionpadMcpToolNames],
  admin: [...actionpadMcpToolNames],
  unknown: [],
}

const allowedAgentRestartIntents = new Set<string>([
  "explicit_user_request",
  "runtime_changes_need_reload",
])

function isKnownTool(toolName: string): toolName is ActionpadMcpToolName {
  return actionpadMcpToolNames.includes(toolName as ActionpadMcpToolName)
}

function allow(reason: string): ActionpadMcpDecision {
  return { allowed: true, reason }
}

function deny(reason: string): ActionpadMcpDecision {
  return { allowed: false, reason }
}

export function getVisibleActionpadMcpTools(profile: ActionpadMcpProfile): ActionpadMcpToolName[] {
  return [...visibleToolsByProfile[profile]]
}

export function authorizeActionpadMcpCall(
  profile: ActionpadMcpProfile,
  toolName: string,
  args: Record<string, unknown> = {},
): ActionpadMcpDecision {
  if (profile === "unknown") return deny("unknown profile is not authorized")
  if (!isKnownTool(toolName)) return deny("unknown tool is not authorized")

  if (toolName === "request_app_refresh") {
    return allow("profile may request app refresh")
  }

  if (profile === "admin") {
    return allow("admin may request runtime restart")
  }

  if (allowedAgentRestartIntents.has(String(args.userIntent ?? ""))) {
    return allow("agent restart intent is allowed")
  }

  return deny("agent restart requires explicit user intent")
}
