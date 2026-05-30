export type RunId = string
export type AgentProviderId = "codex"

export type RuntimeOutlineSnapshot = {
  rootIds: string[]
  nodes: Record<
    string,
    {
      id: string
      parentId: string | null
      children: string[]
      text: string
      collapsed: boolean
      runStatus: "idle" | "running" | "succeeded" | "failed"
      threadId?: string
      activeRunId?: RunId
      metadata: Record<string, unknown>
    }
  >
  focusedNodeId: string | null
}

export type StartRunRequest = {
  provider: AgentProviderId
  nodeId: string
  prompt: string
  context: string
  outline: RuntimeOutlineSnapshot
}

export type AgentMessageInput = {
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt?: number
  providerMetadata?: Record<string, unknown>
}

export type ApprovalRequest = {
  id: string
  runId: RunId
  title: string
  description?: string
  createdAt: number
  providerMetadata?: Record<string, unknown>
}

export type OutlinePatch =
  | {
      type: "append-child-bullets"
      parentId: string
      bullets: Array<{ text: string; metadata?: Record<string, unknown> }>
    }
  | { type: "update-bullet-text"; nodeId: string; text: string }
  | {
      type: "set-bullet-run-status"
      nodeId: string
      status: "idle" | "running" | "succeeded" | "failed"
      activeRunId?: RunId | null
    }

export type AgentRuntimeEvent =
  | { type: "run-started"; runId: RunId; threadId: string; nodeId: string; createdAt: number }
  | { type: "message-created"; runId: RunId; message: AgentMessageInput; createdAt: number }
  | { type: "outline-patch"; runId: RunId; patch: OutlinePatch; createdAt: number }
  | { type: "tool-started"; runId: RunId; toolCallId: string; name: string; createdAt: number }
  | {
      type: "tool-completed"
      runId: RunId
      toolCallId: string
      output?: string
      createdAt: number
    }
  | { type: "approval-requested"; runId: RunId; approval: ApprovalRequest; createdAt: number }
  | { type: "run-completed"; runId: RunId; createdAt: number }
  | { type: "run-failed"; runId: RunId; error: string; createdAt: number }

type ValidationResult = { ok: true } | { ok: false; error: string }

const RUN_STATUSES = new Set(["idle", "running", "succeeded", "failed"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function validateOutlinePatch(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: "Unsupported outline patch type." }
  }

  switch (value.type) {
    case "append-child-bullets": {
      if (!isNonEmptyString(value.parentId)) {
        return { ok: false, error: "Appended bullets need a parent." }
      }
      if (!Array.isArray(value.bullets) || value.bullets.length === 0) {
        return { ok: false, error: "Append-child-bullets needs bullets." }
      }
      if (
        !value.bullets.every(
          (bullet) => isRecord(bullet) && isNonEmptyString(bullet.text),
        )
      ) {
        return { ok: false, error: "Each appended bullet needs text." }
      }
      return { ok: true }
    }
    case "update-bullet-text":
      if (!isNonEmptyString(value.nodeId)) {
        return { ok: false, error: "Updated bullet needs a node." }
      }
      if (!isNonEmptyString(value.text)) {
        return { ok: false, error: "Updated bullet needs text." }
      }
      return { ok: true }
    case "set-bullet-run-status":
      if (!isNonEmptyString(value.nodeId)) {
        return { ok: false, error: "Status update needs a node." }
      }
      if (typeof value.status !== "string" || !RUN_STATUSES.has(value.status)) {
        return { ok: false, error: "Status update needs a supported status." }
      }
      return { ok: true }
    default:
      return { ok: false, error: "Unsupported outline patch type." }
  }
}
