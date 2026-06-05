import { z } from "zod"
import { authorizeActionpadMcpCall, getVisibleActionpadMcpTools } from "./policy"
import type {
  ActionpadMcpAuditRecord,
  ActionpadMcpProfile,
  ActionpadMcpToolName,
  RequestAppRefreshResult,
  RequestRuntimeRestartResult,
} from "./types"

type ActionpadMcpAuditLogger = {
  record(record: ActionpadMcpAuditRecord): Promise<void>
}

type ActionpadRuntimeClient = {
  requestAppRefresh(): Promise<RequestAppRefreshResult>
  requestRuntimeRestart(): Promise<RequestRuntimeRestartResult>
}

type ActionpadMcpToolAnnotations = {
  title: string
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export type ActionpadMcpToolDefinition = {
  name: ActionpadMcpToolName
  title: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  outputSchema: z.ZodObject<z.ZodRawShape>
  annotations: ActionpadMcpToolAnnotations
  metadata: {
    actionpad: {
      runtimeCall: "requestAppRefresh" | "requestRuntimeRestart"
      policy: string
    }
  }
}

export type ActionpadMcpToolResult = {
  content: Array<{
    type: "text"
    text: string
  }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type ActionpadMcpToolState = {
  lastSuccessfulAppRefreshAt: number | null
}

type ActionpadMcpToolsOptions = {
  profile: ActionpadMcpProfile
  runtimeClient: ActionpadRuntimeClient
  auditLogger: ActionpadMcpAuditLogger
  now?: () => Date
  state?: ActionpadMcpToolState
}

const refreshRateLimitMs = 2_000
const maxReasonLength = 200
const maxErrorTextLength = 180

const conciseReasonSchema = z
  .string()
  .trim()
  .min(1, "reason must be non-empty")
  .max(maxReasonLength, `reason must be at most ${maxReasonLength} characters`)

const requestAppRefreshInputSchema = z
  .object({
    reason: conciseReasonSchema,
  })
  .strict()

const requestAppRefreshOutputSchema = z
  .object({
    requested: z.literal(true),
    runtimeUrl: z.string().min(1),
  })
  .strict()

const requestRuntimeRestartInputSchema = z
  .object({
    reason: conciseReasonSchema,
    userIntent: z.enum(["explicit_user_request", "runtime_changes_need_reload"]).optional(),
  })
  .strict()

const requestRuntimeRestartOutputSchema = z
  .object({
    requested: z.boolean(),
    pending: z.boolean(),
    runtimeUrl: z.string().min(1),
  })
  .strict()

const toolDefinitions: Record<ActionpadMcpToolName, ActionpadMcpToolDefinition> = {
  request_app_refresh: {
    name: "request_app_refresh",
    title: "Request app refresh",
    description: "Ask the Actionpad runtime to refresh the active app view.",
    inputSchema: requestAppRefreshInputSchema,
    outputSchema: requestAppRefreshOutputSchema,
    annotations: {
      title: "Request app refresh",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    metadata: {
      actionpad: {
        runtimeCall: "requestAppRefresh",
        policy: "agent and admin profiles may request app refresh",
      },
    },
  },
  request_runtime_restart: {
    name: "request_runtime_restart",
    title: "Request runtime restart",
    description: "Ask the Actionpad runtime to restart when explicitly authorized by policy.",
    inputSchema: requestRuntimeRestartInputSchema,
    outputSchema: requestRuntimeRestartOutputSchema,
    annotations: {
      title: "Request runtime restart",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    metadata: {
      actionpad: {
        runtimeCall: "requestRuntimeRestart",
        policy: "admin profile or approved agent user intent may request runtime restart",
      },
    },
  },
}

function textResult(text: string, isError?: true): ActionpadMcpToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError } : {}),
  }
}

function jsonResult(value: Record<string, unknown>): ActionpadMcpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const trimmed = message.trim() || "unknown error"
  if (trimmed.length <= maxErrorTextLength) return trimmed
  return `${trimmed.slice(0, maxErrorTextLength - 3)}...`
}

function auditArguments(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }

  return { value: args }
}

async function auditCall(
  auditLogger: ActionpadMcpAuditLogger,
  record: ActionpadMcpAuditRecord,
): Promise<void> {
  await auditLogger.record(record)
}

export function createActionpadMcpTools(options: ActionpadMcpToolsOptions): {
  listTools(): ActionpadMcpToolDefinition[]
  callTool(toolName: string, args?: unknown): Promise<ActionpadMcpToolResult>
} {
  const now = options.now ?? (() => new Date())
  const state = options.state ?? { lastSuccessfulAppRefreshAt: null }

  async function denyCall(
    toolName: string,
    args: Record<string, unknown>,
    reason: string,
    error = "denied",
  ): Promise<ActionpadMcpToolResult> {
    await auditCall(options.auditLogger, {
      profile: options.profile,
      toolName,
      allowed: false,
      arguments: args,
      outcome: "denied",
      reason,
      error,
    })

    return textResult(reason, true)
  }

  async function failCall(
    toolName: string,
    args: Record<string, unknown>,
    allowed: boolean,
    reason: string,
    error: string,
    runtimeUrl?: string,
  ): Promise<ActionpadMcpToolResult> {
    await auditCall(options.auditLogger, {
      profile: options.profile,
      toolName,
      allowed,
      arguments: args,
      ...(runtimeUrl ? { runtimeUrl } : {}),
      outcome: "failed",
      reason,
      error,
    })

    return textResult(error, true)
  }

  async function succeedCall(
    toolName: ActionpadMcpToolName,
    args: Record<string, unknown>,
    reason: string,
    result: RequestAppRefreshResult | RequestRuntimeRestartResult,
  ): Promise<ActionpadMcpToolResult> {
    await auditCall(options.auditLogger, {
      profile: options.profile,
      toolName,
      allowed: true,
      arguments: args,
      runtimeUrl: result.runtimeUrl,
      outcome: "succeeded",
      reason,
    })

    return jsonResult(result)
  }

  return {
    listTools(): ActionpadMcpToolDefinition[] {
      return getVisibleActionpadMcpTools(options.profile).map((toolName) => toolDefinitions[toolName])
    },

    async callTool(toolName: string, args: unknown = {}): Promise<ActionpadMcpToolResult> {
      const argsForAudit = auditArguments(args)
      const decision = authorizeActionpadMcpCall(options.profile, toolName, argsForAudit)

      if (!decision.allowed) {
        return denyCall(toolName, argsForAudit, decision.reason)
      }

      const toolDefinition = toolDefinitions[toolName as ActionpadMcpToolName]
      if (!toolDefinition) {
        return denyCall(toolName, argsForAudit, "unknown tool is not authorized")
      }

      const input = toolDefinition.inputSchema.safeParse(args)
      if (!input.success) {
        return failCall(
          toolName,
          argsForAudit,
          true,
          decision.reason,
          `Invalid ${toolName} arguments`,
        )
      }

      if (toolName === "request_app_refresh") {
        const currentTime = now().getTime()
        if (
          state.lastSuccessfulAppRefreshAt !== null &&
          currentTime - state.lastSuccessfulAppRefreshAt < refreshRateLimitMs
        ) {
          return denyCall(
            toolName,
            argsForAudit,
            "rate limited: app refresh requested too frequently",
            "rate limited",
          )
        }

        try {
          const result = requestAppRefreshOutputSchema.parse(await options.runtimeClient.requestAppRefresh())
          state.lastSuccessfulAppRefreshAt = currentTime
          return succeedCall(toolName, input.data, decision.reason, result)
        } catch (error) {
          return failCall(toolName, input.data, true, decision.reason, conciseError(error))
        }
      }

      try {
        const result = requestRuntimeRestartOutputSchema.parse(
          await options.runtimeClient.requestRuntimeRestart(),
        )
        return succeedCall("request_runtime_restart", input.data, decision.reason, result)
      } catch (error) {
        return failCall(toolName, input.data, true, decision.reason, conciseError(error))
      }
    },
  }
}
