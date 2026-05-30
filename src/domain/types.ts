export type BulletId = string
export type ThreadId = string

export type BulletRunStatus = "idle" | "running" | "succeeded" | "failed"

export type BulletNode = {
  id: BulletId
  parentId: BulletId | null
  children: BulletId[]
  text: string
  collapsed: boolean
  runStatus: BulletRunStatus
  threadId?: ThreadId
  metadata: Record<string, unknown>
}

export type OutlineState = {
  rootIds: BulletId[]
  nodes: Record<BulletId, BulletNode>
  focusedNodeId: BulletId | null
  selectedThreadId: ThreadId | null
  panelOpen: boolean
  threads: Record<ThreadId, AgentThread>
}

export type AgentThread = {
  id: ThreadId
  nodeId: BulletId
  messages: AgentMessage[]
  events: AgentEvent[]
}

export type AgentMessage = {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt: number
  status?: "streaming" | "complete" | "error"
}

export type AgentEvent =
  | { type: "run-started"; nodeId: BulletId; createdAt: number }
  | { type: "message-created"; messageId: string; createdAt: number }
  | { type: "outline-output"; output: OutlineOutput; createdAt: number }
  | { type: "run-completed"; nodeId: BulletId; createdAt: number }

export type OutlineOutput =
  | { type: "append-child-bullets"; parentId: BulletId; bullets: BulletDraft[] }
  | { type: "update-node-status"; nodeId: BulletId; status: BulletRunStatus }

export type BulletDraft = {
  text: string
  metadata?: Record<string, unknown>
}
