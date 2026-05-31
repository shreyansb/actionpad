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

function renderEvent(event: RenderableEvent, key: string) {
  if (event.type === "outline-output") {
    return (
      <article key={key} className="event-card">
        <strong>Outline output</strong>
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
        <strong>Run failed</strong>
        <p>{event.error}</p>
      </article>
    )
  }
  if (event.type === "approval-requested") {
    return (
      <article key={key} className="event-card is-warning">
        <strong>Approval requested</strong>
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
              <div className="chat-role">{message.role}</div>
              <p>{message.content}</p>
            </article>
          )
        }
        if (item.type === "tool-group") {
          const label = `${item.events.length} tool call${item.events.length === 1 ? "" : "s"}`
          return (
            <details
              key={`tool-group-${index}`}
              className="tool-call-group"
              aria-label={label}
            >
              <summary>{label}</summary>
              <div className="tool-call-list">
                {item.events.map((event) => (
                  <div
                    key={`${event.createdAt}-${event.toolCallId}`}
                    className="tool-call-item"
                  >
                    <strong>{event.type === "tool-started" ? "Started" : "Completed"}</strong>
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
