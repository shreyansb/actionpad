import type {
  AgentMessageInput,
  AgentProviderId,
  AgentRuntimeEvent,
  RunId,
  StartRunRequest,
} from "../src/domain/runtimeProtocol"
import type { ThreadId } from "../src/domain/types"

declare global {
  // Keep existing browser timer refs type-checking after adding Node globals.
  interface Number extends NodeJS.Timeout {}
}

export type AgentThreadSnapshot = {
  id: ThreadId
  provider: AgentProviderId
  providerThreadId: string | null
  nodeId: string
  messages: AgentMessageInput[]
  runs: RunId[]
  providerMetadata: Record<string, unknown>
}

export type AssistantRuntimeEvent =
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
    }

export type AgentProviderEvent = AgentRuntimeEvent | AssistantRuntimeEvent

export interface AgentProvider {
  id: AgentProviderId
  startRun(request: StartRunRequest): AsyncIterable<AgentProviderEvent>
  sendMessage(threadId: ThreadId, message: AgentMessageInput): AsyncIterable<AgentProviderEvent>
  cancelRun(runId: RunId): Promise<void> | void
  getThread(threadId: ThreadId): Promise<AgentThreadSnapshot | null> | AgentThreadSnapshot | null
}
