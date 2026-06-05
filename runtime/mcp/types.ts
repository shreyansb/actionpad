export type ActionpadMcpProfile = "agent" | "admin" | "unknown"

export const actionpadMcpToolNames = [
  "request_app_refresh",
  "request_runtime_restart",
] as const

export type ActionpadMcpToolName = (typeof actionpadMcpToolNames)[number]

export type ActionpadMcpTransport = "stdio" | "http"

export type ActionpadMcpConfig = {
  runtimeUrl: string
  profile: ActionpadMcpProfile
  auditLogPath?: string
  transport: ActionpadMcpTransport
  http: {
    host: string
    port: number
  }
}

export type ActionpadMcpDecision =
  | {
      allowed: true
      reason: string
    }
  | {
      allowed: false
      reason: string
    }

export type ActionpadMcpAuditRecord = {
  timestamp?: string
  profile: ActionpadMcpProfile
  toolName: ActionpadMcpToolName | string
  allowed: boolean
  arguments?: Record<string, unknown>
  runtimeUrl?: string
  outcome?: "succeeded" | "denied" | "failed"
  reason?: string
  error?: string
}

export type RequestAppRefreshResult = {
  requested: boolean
  runtimeUrl: string
}

export type RequestRuntimeRestartResult = {
  requested: boolean
  pending: boolean
  runtimeUrl: string
}
