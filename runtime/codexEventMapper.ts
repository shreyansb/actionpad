import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk"
import type { AgentRuntimeEvent, RunId } from "../src/domain/runtimeProtocol"
import type { ThreadId } from "../src/domain/types"

type MapperOptions = {
  runId: RunId
  threadId: ThreadId
  nodeId: string
  startedAt?: number
  now?: () => number
}

type CodexEventMapper = {
  map(event: ThreadEvent): AgentRuntimeEvent[]
  finalAssistantText(): string
  providerThreadId(): string | null
}

function summarizeFileChanges(item: Extract<ThreadItem, { type: "file_change" }>): string {
  return item.changes.map((change) => `${change.kind} ${change.path}`).join("\n")
}

function summarizeMcpTool(item: Extract<ThreadItem, { type: "mcp_tool_call" }>): string {
  if (item.error) return item.error.message
  if (!item.result) return ""
  return item.result.content.map((block) => ("text" in block ? block.text : block.type)).join("\n")
}

export function createCodexEventMapper(options: MapperOptions): CodexEventMapper {
  const now = options.now ?? (() => options.startedAt ?? Date.now())
  const completedAssistantText = new Map<string, string>()
  const startedMessages = new Set<string>()
  let providerThreadId: string | null = null
  let emittedRunStarted = false

  function ensureRunStarted(createdAt: number): AgentRuntimeEvent[] {
    if (emittedRunStarted) return []
    emittedRunStarted = true
    return [
      {
        type: "run-started",
        runId: options.runId,
        threadId: options.threadId,
        nodeId: options.nodeId,
        provider: "codex",
        providerThreadId,
        createdAt,
      },
    ]
  }

  function mapItem(eventType: ThreadEvent["type"], item: ThreadItem): AgentRuntimeEvent[] {
    const createdAt = now()
    const prefix = ensureRunStarted(createdAt)
    switch (item.type) {
      case "agent_message": {
        const events: AgentRuntimeEvent[] = []
        if (!startedMessages.has(item.id)) {
          startedMessages.add(item.id)
          events.push({
            type: "assistant-message-started",
            runId: options.runId,
            messageId: item.id,
            createdAt,
          })
        }
        if (eventType === "item.completed") {
          const previous = completedAssistantText.get(item.id) ?? ""
          const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text
          completedAssistantText.set(item.id, item.text)
          if (delta) {
            events.push({
              type: "assistant-delta",
              runId: options.runId,
              messageId: item.id,
              delta,
              createdAt,
            })
          }
          events.push({
            type: "assistant-message-completed",
            runId: options.runId,
            messageId: item.id,
            content: item.text,
            createdAt,
          })
        }
        return [...prefix, ...events]
      }
      case "reasoning":
        if (eventType !== "item.completed" || !item.text.trim()) return prefix
        return [
          ...prefix,
          {
            type: "message-created",
            runId: options.runId,
            message: {
              id: item.id,
              role: "system",
              content: item.text,
              createdAt,
              status: "complete",
            },
            createdAt,
          },
        ]
      case "command_execution":
        if (eventType === "item.started") {
          return [
            ...prefix,
            {
              type: "tool-started",
              runId: options.runId,
              toolCallId: item.id,
              name: item.command,
              createdAt,
            },
          ]
        }
        if (eventType === "item.completed") {
          return [
            ...prefix,
            {
              type: "tool-completed",
              runId: options.runId,
              toolCallId: item.id,
              name: item.command,
              output: item.aggregated_output,
              createdAt,
            },
          ]
        }
        return prefix
      case "file_change":
        if (eventType !== "item.completed") return prefix
        return [
          ...prefix,
          {
            type: "tool-completed",
            runId: options.runId,
            toolCallId: item.id,
            name: "File changes",
            output: summarizeFileChanges(item),
            createdAt,
          },
        ]
      case "mcp_tool_call":
        if (eventType === "item.started") {
          return [
            ...prefix,
            {
              type: "tool-started",
              runId: options.runId,
              toolCallId: item.id,
              name: `${item.server}.${item.tool}`,
              createdAt,
            },
          ]
        }
        if (eventType === "item.completed") {
          return [
            ...prefix,
            {
              type: "tool-completed",
              runId: options.runId,
              toolCallId: item.id,
              name: `${item.server}.${item.tool}`,
              output: summarizeMcpTool(item),
              createdAt,
            },
          ]
        }
        return prefix
      case "web_search":
        if (eventType !== "item.started") return prefix
        return [
          ...prefix,
          {
            type: "tool-started",
            runId: options.runId,
            toolCallId: item.id,
            name: `Web search: ${item.query}`,
            createdAt,
          },
        ]
      case "error":
        return [
          ...prefix,
          { type: "run-failed", runId: options.runId, error: item.message, createdAt },
        ]
      case "todo_list":
        return prefix
    }
  }

  return {
    map(event) {
      const createdAt = now()
      switch (event.type) {
        case "thread.started":
          providerThreadId = event.thread_id
          return ensureRunStarted(createdAt)
        case "item.started":
        case "item.updated":
        case "item.completed":
          return mapItem(event.type, event.item)
        case "turn.failed":
          return [
            ...ensureRunStarted(createdAt),
            { type: "run-failed", runId: options.runId, error: event.error.message, createdAt },
          ]
        case "error":
          return [
            ...ensureRunStarted(createdAt),
            { type: "run-failed", runId: options.runId, error: event.message, createdAt },
          ]
        case "turn.completed":
        case "turn.started":
          return ensureRunStarted(createdAt)
      }
    },
    finalAssistantText() {
      const texts = Array.from(completedAssistantText.values())
      return texts[texts.length - 1] ?? ""
    },
    providerThreadId() {
      return providerThreadId
    },
  }
}
