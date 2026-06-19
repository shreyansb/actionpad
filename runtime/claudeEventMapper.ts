import type { AgentRuntimeEvent, RunId } from "../src/domain/runtimeProtocol"
import type { ThreadId } from "../src/domain/types"
import type { ClaudeStreamJsonEvent } from "./claudeCliRunner"
import { stripOutlineOutputBlocks } from "./outlineOutput"

type MapperOptions = {
  runId: RunId
  threadId: ThreadId
  nodeId: string
  prompt?: string
  context?: string
  providerThreadId?: string | null
  now?: () => number
}

type ClaudeContentBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function contentBlocks(event: ClaudeStreamJsonEvent): ClaudeContentBlock[] {
  const message = isRecord(event.message) ? event.message : null
  const content = message?.content
  return Array.isArray(content) ? (content as ClaudeContentBlock[]) : []
}

function messageId(event: ClaudeStreamJsonEvent): string {
  const message = isRecord(event.message) ? event.message : null
  return typeof message?.id === "string" ? message.id : `${event.type ?? "claude"}-message`
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : JSON.stringify(item)))
      .join("\n")
  }
  return value === undefined ? "" : JSON.stringify(value)
}

export function createClaudeEventMapper(options: MapperOptions) {
  const now = options.now ?? Date.now
  const completedAssistantText = new Map<string, string>()
  const startedMessages = new Set<string>()
  const toolNames = new Map<string, string>()
  let providerThreadId = options.providerThreadId ?? null
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
        provider: "claude",
        providerThreadId,
        prompt: options.prompt,
        context: options.context,
        createdAt,
      },
    ]
  }

  function mapAssistant(event: ClaudeStreamJsonEvent, createdAt: number): AgentRuntimeEvent[] {
    const id = messageId(event)
    const events = ensureRunStarted(createdAt)
    const blocks = contentBlocks(event)
    const rawText = blocks
      .filter((block): block is Extract<ClaudeContentBlock, { type: "text" }> => block.type === "text")
      .filter((block) => typeof block.text === "string")
      .map((block) => block.text)
      .join("")

    if (rawText) {
      if (!startedMessages.has(id)) {
        startedMessages.add(id)
        events.push({ type: "assistant-message-started", runId: options.runId, messageId: id, createdAt })
      }

      const displayText = stripOutlineOutputBlocks(rawText)
      const previous = completedAssistantText.get(id) ?? ""
      const previousDisplayText = stripOutlineOutputBlocks(previous)
      const delta = displayText.startsWith(previousDisplayText)
        ? displayText.slice(previousDisplayText.length)
        : displayText
      completedAssistantText.set(id, rawText)
      if (delta) {
        events.push({ type: "assistant-delta", runId: options.runId, messageId: id, delta, createdAt })
      }
      events.push({
        type: "assistant-message-completed",
        runId: options.runId,
        messageId: id,
        content: displayText,
        createdAt,
      })
    }

    for (const block of blocks) {
      if (block.type !== "tool_use" || !block.id) continue
      const name = block.name ?? "Claude tool"
      toolNames.set(block.id, name)
      events.push({ type: "tool-started", runId: options.runId, toolCallId: block.id, name, createdAt })
    }

    return events
  }

  function mapToolResults(event: ClaudeStreamJsonEvent, createdAt: number): AgentRuntimeEvent[] {
    const events = ensureRunStarted(createdAt)
    for (const block of contentBlocks(event)) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue
      events.push({
        type: "tool-completed",
        runId: options.runId,
        toolCallId: block.tool_use_id,
        name: toolNames.get(block.tool_use_id),
        output: stringifyToolOutput(block.content),
        createdAt,
      })
    }
    return events
  }

  return {
    map(event: ClaudeStreamJsonEvent): AgentRuntimeEvent[] {
      const createdAt = now()
      if (typeof event.session_id === "string") {
        providerThreadId = event.session_id
      }

      switch (event.type) {
        case "system":
          return ensureRunStarted(createdAt)
        case "assistant":
          return mapAssistant(event, createdAt)
        case "user":
          return mapToolResults(event, createdAt)
        case "result": {
          if (event.is_error === true || String(event.subtype ?? "").startsWith("error")) {
            return [
              ...ensureRunStarted(createdAt),
              {
                type: "run-failed",
                runId: options.runId,
                error:
                  typeof event.error === "string"
                    ? event.error
                    : typeof event.result === "string"
                      ? event.result
                      : "Claude Code run failed.",
                createdAt,
              },
            ]
          }
          return ensureRunStarted(createdAt)
        }
        default:
          return ensureRunStarted(createdAt)
      }
    },
    finalAssistantText(): string {
      const texts = Array.from(completedAssistantText.values())
      return texts[texts.length - 1] ?? ""
    },
    providerThreadId(): string | null {
      return providerThreadId
    },
  }
}
