import { useEffect, useRef } from "react"
import type { AgentEvent, AgentMessage } from "../domain/types"

type ChatThreadViewProps = {
  messages: AgentMessage[]
  events: AgentEvent[]
}

type ToolEvent = Extract<AgentEvent, { type: "tool-started" | "tool-completed" }>
type RenderableEvent = Extract<
  AgentEvent,
  { type: "outline-output" | "run-failed" | "approval-requested" }
>
type VisibleEvent = ToolEvent | RenderableEvent

type TimelineEntry =
  | { type: "message"; message: AgentMessage; createdAt: number; order: number }
  | { type: "event"; event: VisibleEvent; createdAt: number; order: number }

type TimelineItem =
  | { type: "message"; message: AgentMessage }
  | { type: "event"; event: RenderableEvent }
  | { type: "tool-group"; events: ToolEvent[] }

type MessageChunk =
  | { type: "text"; text: string }
  | { type: "outline-output"; text: string }

const OUTLINE_OUTPUT_BLOCK_PATTERN =
  /<actionpad-outline-output>([\s\S]*?)<\/actionpad-outline-output>/g

function formatLocalDateTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString()
}

function Timestamp({ createdAt }: { createdAt: number }) {
  return (
    <time className="chat-timestamp" dateTime={new Date(createdAt).toISOString()}>
      {formatLocalDateTime(createdAt)}
    </time>
  )
}

function isToolEvent(event: VisibleEvent): event is ToolEvent {
  return event.type === "tool-started" || event.type === "tool-completed"
}

function isRenderableEvent(event: AgentEvent): event is VisibleEvent {
  return (
    event.type === "outline-output" ||
    event.type === "run-failed" ||
    event.type === "tool-started" ||
    event.type === "tool-completed" ||
    event.type === "approval-requested"
  )
}

function buildTimelineItems(messages: AgentMessage[], events: AgentEvent[]): TimelineItem[] {
  const entries: TimelineEntry[] = [
    ...messages.map((message, index) => ({
      type: "message" as const,
      message,
      createdAt: message.createdAt,
      order: index * 2,
    })),
    ...events.filter(isRenderableEvent).map((event, index) => ({
      type: "event" as const,
      event,
      createdAt: event.createdAt,
      order: index * 2 + 1,
    })),
  ].sort((left, right) => left.createdAt - right.createdAt || left.order - right.order)

  const items: TimelineItem[] = []
  let toolEvents: ToolEvent[] = []
  const flushToolEvents = () => {
    if (toolEvents.length === 0) return
    items.push({ type: "tool-group", events: toolEvents })
    toolEvents = []
  }

  for (const entry of entries) {
    if (entry.type === "message") {
      flushToolEvents()
      items.push({ type: "message", message: entry.message })
      continue
    }

    const event = entry.event
    if (isToolEvent(event)) {
      toolEvents.push(event)
      continue
    }
    flushToolEvents()
    items.push({ type: "event", event })
  }
  flushToolEvents()
  return items
}

function splitMessageContent(content: string): MessageChunk[] {
  const chunks: MessageChunk[] = []
  let cursor = 0

  for (const match of content.matchAll(OUTLINE_OUTPUT_BLOCK_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) chunks.push({ type: "text", text: content.slice(cursor, index) })
    chunks.push({ type: "outline-output", text: (match[1] ?? "").trim() })
    cursor = index + match[0].length
  }

  if (cursor < content.length) chunks.push({ type: "text", text: content.slice(cursor) })
  return chunks.length > 0 ? chunks : [{ type: "text", text: content }]
}

function renderMessageContent(content: string) {
  return (
    <div className="chat-message-content">
      {splitMessageContent(content).map((chunk, index) => {
        if (chunk.type === "text") {
          const text = chunk.text.trim()
          return text ? <p key={index}>{text}</p> : null
        }
        return (
          <details key={index} className="outline-output-block">
            <summary>Outline patch</summary>
            {chunk.text ? <pre>{chunk.text}</pre> : null}
          </details>
        )
      })}
    </div>
  )
}

function renderEvent(event: RenderableEvent, key: string) {
  if (event.type === "outline-output") {
    return (
      <article key={key} className="event-card">
        <div className="chat-entry-title">
          <strong>Outline output</strong>
          <Timestamp createdAt={event.createdAt} />
        </div>
        {event.output.type === "append-child-bullets" ? (
          <p>Appended {event.output.bullets.length} child bullets.</p>
        ) : (
          <p>Updated outline state.</p>
        )}
      </article>
    )
  }
  if (event.type === "run-failed") {
    return (
      <article key={key} className="event-card is-error">
        <div className="chat-entry-title">
          <strong>Run failed</strong>
          <Timestamp createdAt={event.createdAt} />
        </div>
        <p>{event.error}</p>
      </article>
    )
  }
  if (event.type === "approval-requested") {
    return (
      <article key={key} className="event-card is-warning">
        <div className="chat-entry-title">
          <strong>Approval requested</strong>
          <Timestamp createdAt={event.createdAt} />
        </div>
        <p>{event.approvalId}</p>
      </article>
    )
  }
  return null
}

export function ChatThreadView({ messages, events }: ChatThreadViewProps) {
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const timelineItems = buildTimelineItems(messages, events)

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    timeline.scrollTop = timeline.scrollHeight
  }, [messages, events])

  return (
    <div className="chat-timeline" ref={timelineRef}>
      {timelineItems.map((item, index) => {
        if (item.type === "message") {
          const message = item.message
          return (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <div className="chat-role chat-entry-title">
                <span>{message.role}</span>
                <Timestamp createdAt={message.createdAt} />
              </div>
              {renderMessageContent(message.content)}
            </article>
          )
        }
        if (item.type === "tool-group") {
          const label = `${item.events.length} tool call${item.events.length === 1 ? "" : "s"}`
          const groupCreatedAt = item.events[0]?.createdAt
          return (
            <details
              key={`tool-group-${index}`}
              className="tool-call-group"
              aria-label={label}
            >
              <summary>
                <span className="chat-entry-title">
                  <span>{label}</span>
                  {groupCreatedAt === undefined ? null : <Timestamp createdAt={groupCreatedAt} />}
                </span>
              </summary>
              <div className="tool-call-list">
                {item.events.map((event) => (
                  <div
                    key={`${event.createdAt}-${event.toolCallId}`}
                    className="tool-call-item"
                  >
                    <div className="chat-entry-title">
                      <strong>{event.type === "tool-started" ? "Started" : "Completed"}</strong>
                      <Timestamp createdAt={event.createdAt} />
                    </div>
                    <p>{event.name ?? event.toolCallId}</p>
                  </div>
                ))}
              </div>
            </details>
          )
        }
        return renderEvent(item.event, `${item.event.createdAt}-${index}`)
      })}
    </div>
  )
}
