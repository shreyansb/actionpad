import type {
  AgentProviderId,
  AssistantOutcome,
  BulletMention,
  OutlinePatch,
  RunId,
} from "./runtimeProtocol"

export type BulletId = string
export type ThreadId = string

export type BulletRunStatus = "idle" | "running" | "succeeded" | "failed"
export type AgentRunStatus = "running" | "succeeded" | "failed"

export type BulletNode = {
  id: BulletId
  parentId: BulletId | null
  children: BulletId[]
  text: string
  collapsed: boolean
  runStatus: BulletRunStatus
  threadId?: ThreadId
  activeRunId?: RunId
  metadata: Record<string, unknown> & { mentions?: BulletMention[] }
}

export type OutlineUndoSnapshot = {
  rootIds: BulletId[]
  nodes: Record<BulletId, BulletNode>
  focusedNodeId: BulletId | null
  selectedThreadId: ThreadId | null
  chatFocusRequest: number
  panelOpen: boolean
  threads: Record<ThreadId, AgentThread>
  runs: Record<RunId, AgentRun>
}

export type OutlineState = OutlineUndoSnapshot & {
  undoStack: OutlineUndoSnapshot[]
}

export type AgentThread = {
  id: ThreadId
  provider: AgentProviderId
  providerThreadId: string | null
  nodeId: BulletId
  messages: AgentMessage[]
  events: AgentEvent[]
  runs: RunId[]
  lastActivityAt?: number
  lastSeenAt?: number
}

export type AgentRun = {
  id: RunId
  threadId: ThreadId
  nodeId: BulletId
  provider: AgentProviderId
  status: AgentRunStatus
  prompt: string
  context: string
  createdAt: number
  updatedAt: number
  error?: string
  outcome?: AssistantOutcome
  providerMetadata: Record<string, unknown>
}

export type AgentMessage = {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt: number
  status?: "streaming" | "complete" | "error"
}

export type AgentEvent =
  | { type: "run-started"; nodeId: BulletId; createdAt: number; runId?: RunId }
  | { type: "message-created"; messageId: string; createdAt: number; runId?: RunId }
  | { type: "outline-output"; output: OutlineOutput; createdAt: number; runId?: RunId; patchKey?: string }
  | { type: "tool-started"; toolCallId: string; name: string; createdAt: number; runId?: RunId }
  | {
      type: "tool-completed"
      toolCallId: string
      name?: string
      createdAt: number
      runId?: RunId
      output?: string
    }
  | { type: "approval-requested"; approvalId: string; createdAt: number; runId?: RunId }
  | {
      type: "run-completed"
      nodeId: BulletId
      createdAt: number
      runId?: RunId
      outcome?: AssistantOutcome
    }
  | { type: "run-failed"; nodeId: BulletId; error: string; createdAt: number; runId?: RunId }

export type OutlineOutput = OutlinePatch

export type BulletDraft = {
  text: string
  metadata?: Record<string, unknown>
  children?: BulletDraft[]
}
