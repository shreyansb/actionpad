export type RunId = string
export type AgentProviderId = "codex"

export type BulletMention = {
  id: string
  kind: "file" | "folder"
  path: string
  label: string
  token: string
  createdAt: number
}

export type FilesystemEntry = {
  name: string
  path: string
  kind: "file" | "folder"
}

export type FilesystemListResponse = {
  path: string
  parentPath: string | null
  entries: FilesystemEntry[]
}

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
  mentions?: BulletMention[]
}

export type SendMessageRequest = StartRunRequest & {
  threadId: string
  providerThreadId?: string | null
}

export type AgentMessageInput = {
  id?: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt?: number
  status?: "streaming" | "complete" | "error"
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
      bullets: RuntimeBulletDraft[]
    }
  | { type: "update-bullet-text"; nodeId: string; text: string }
  | { type: "delete-bullets"; nodeIds: string[] }
  | { type: "batch"; patches: OutlinePatch[] }
  | {
      type: "set-bullet-run-status"
      nodeId: string
      status: "idle" | "running" | "succeeded" | "failed"
      activeRunId?: RunId | null
    }

export type RuntimeBulletDraft = {
  text: string
  metadata?: Record<string, unknown>
  children?: RuntimeBulletDraft[]
}

export type AgentRuntimeEvent =
  | {
      type: "run-started"
      runId: RunId
      threadId: string
      nodeId: string
      createdAt: number
      provider?: AgentProviderId
      providerThreadId?: string | null
      prompt?: string
      context?: string
    }
  | { type: "message-created"; runId: RunId; message: AgentMessageInput; createdAt: number }
  | {
      type: "assistant-message-started"
      runId: RunId
      messageId: string
      createdAt: number
    }
  | {
      type: "assistant-delta"
      runId: RunId
      messageId: string
      delta: string
      createdAt: number
    }
  | {
      type: "assistant-message-completed"
      runId: RunId
      messageId: string
      createdAt: number
      text?: string
      content?: string
    }
  | { type: "outline-patch"; runId: RunId; patch: OutlinePatch; createdAt: number }
  | { type: "tool-started"; runId: RunId; toolCallId: string; name: string; createdAt: number }
  | {
      type: "tool-completed"
      runId: RunId
      toolCallId: string
      name?: string
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

export function isBulletMention(value: unknown): value is BulletMention {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id) &&
    (value.kind === "file" || value.kind === "folder") &&
    isNonEmptyString(value.path) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.token) &&
    typeof value.createdAt === "number"
  )
}

function validateBulletDraft(value: unknown): ValidationResult {
  if (!isRecord(value) || !isNonEmptyString(value.text)) {
    return { ok: false, error: "Each appended bullet needs text." }
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return { ok: false, error: "Appended bullet metadata must be an object." }
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) {
      return { ok: false, error: "Appended bullet children must be an array." }
    }
    for (const child of value.children) {
      const childValidation = validateBulletDraft(child)
      if (!childValidation.ok) return childValidation
    }
  }
  return { ok: true }
}

export function validateOutlinePatch(value: unknown, depth = 0): ValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: "Unsupported outline patch type." }
  }
  if (depth > 6) {
    return { ok: false, error: "Outline patch is too deeply nested." }
  }

  switch (value.type) {
    case "append-child-bullets": {
      if (!isNonEmptyString(value.parentId)) {
        return { ok: false, error: "Appended bullets need a parent." }
      }
      if (!Array.isArray(value.bullets) || value.bullets.length === 0) {
        return { ok: false, error: "Append-child-bullets needs bullets." }
      }
      for (const bullet of value.bullets) {
        const validation = validateBulletDraft(bullet)
        if (!validation.ok) return validation
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
    case "delete-bullets":
      if (
        !Array.isArray(value.nodeIds) ||
        value.nodeIds.length === 0 ||
        !value.nodeIds.every((nodeId) => isNonEmptyString(nodeId))
      ) {
        return { ok: false, error: "Delete-bullets needs node ids." }
      }
      return { ok: true }
    case "batch":
      if (!Array.isArray(value.patches) || value.patches.length === 0) {
        return { ok: false, error: "Batch patch needs patches." }
      }
      for (const patch of value.patches) {
        const validation = validateOutlinePatch(patch, depth + 1)
        if (!validation.ok) return validation
      }
      return { ok: true }
    case "set-bullet-run-status":
      if (!isNonEmptyString(value.nodeId)) {
        return { ok: false, error: "Status update needs a node." }
      }
      if (typeof value.status !== "string" || !RUN_STATUSES.has(value.status)) {
        return { ok: false, error: "Status update needs a supported status." }
      }
      if (
        value.activeRunId !== undefined &&
        value.activeRunId !== null &&
        typeof value.activeRunId !== "string"
      ) {
        return { ok: false, error: "Active run id must be a string." }
      }
      return { ok: true }
    default:
      return { ok: false, error: "Unsupported outline patch type." }
  }
}
