import type { AgentProviderId, RunId } from "../src/domain/runtimeProtocol"
import type { AgentProviderEvent } from "./provider"

export type RuntimeLogger = {
  info(message: string): void
}

type ChatStartLog = {
  type: "chat-start"
  kind: "run" | "follow-up"
  provider: AgentProviderId
  nodeId: string
  prompt: string
  threadId?: string
}

type ChatStopLog = {
  type: "chat-stop"
  runId: RunId
}

type ProviderEventLog = {
  type: "provider-event"
  provider: AgentProviderId
  event: AgentProviderEvent
}

type RuntimeLogMessage = ChatStartLog | ChatStopLog | ProviderEventLog

const maxLoggedTextLength = 180
const maxLoggedPromptLength = 20

function quote(value: string): string {
  const trimmed =
    value.length > maxLoggedTextLength ? `${value.slice(0, maxLoggedTextLength - 3)}...` : value
  return JSON.stringify(trimmed)
}

function quotePrompt(value: string): string {
  return JSON.stringify(`${value.slice(0, maxLoggedPromptLength)}...`)
}

export function formatRuntimeLogMessage(message: RuntimeLogMessage): string | null {
  switch (message.type) {
    case "chat-start": {
      const thread = message.threadId ? ` threadId=${message.threadId}` : ""
      return `[runtime] chat start kind=${message.kind} provider=${message.provider} nodeId=${message.nodeId}${thread} prompt=${quotePrompt(message.prompt)}`
    }
    case "chat-stop":
      return `[runtime] chat stop requested runId=${message.runId}`
    case "provider-event":
      return formatProviderEvent(message.provider, message.event)
  }
}

export function logRuntimeMessage(logger: RuntimeLogger, message: RuntimeLogMessage): void {
  const formatted = formatRuntimeLogMessage(message)
  if (formatted) logger.info(formatted)
}

function formatProviderEvent(provider: AgentProviderId, event: AgentProviderEvent): string | null {
  switch (event.type) {
    case "run-started":
      return `[runtime] chat event run-started runId=${event.runId} threadId=${event.threadId} nodeId=${event.nodeId} provider=${event.provider ?? provider}`
    case "outline-patch":
      return `[runtime] chat return outline-patch runId=${event.runId} outcome=${event.patch.outcome ?? "succeeded"}`
    case "run-completed":
      return `[runtime] chat turn-end runId=${event.runId} outcome=${event.outcome ?? "succeeded"}`
    case "run-failed":
      return `[runtime] chat turn-end runId=${event.runId} outcome=failed error=${quote(event.error)}`
    default:
      return null
  }
}
