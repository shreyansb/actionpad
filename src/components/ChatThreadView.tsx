import type { AgentEvent, AgentMessage } from "../domain/types"

type ChatThreadViewProps = {
  messages: AgentMessage[]
  events: AgentEvent[]
}

export function ChatThreadView({ messages, events }: ChatThreadViewProps) {
  return (
    <div className="chat-timeline">
      {messages.map((message) => (
        <article key={message.id} className={`chat-message ${message.role}`}>
          <div className="chat-role">{message.role}</div>
          <p>{message.content}</p>
        </article>
      ))}
      {events.map((event, index) => {
        if (event.type === "outline-output") {
          return (
          <article key={`${event.createdAt}-${index}`} className="event-card">
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
            <article key={`${event.createdAt}-${index}`} className="event-card is-error">
              <strong>Run failed</strong>
              <p>{event.error}</p>
            </article>
          )
        }
        if (event.type === "tool-started" || event.type === "tool-completed") {
          return (
            <article key={`${event.createdAt}-${index}`} className="event-card">
              <strong>{event.type === "tool-started" ? "Tool started" : "Tool completed"}</strong>
              <p>{event.name ?? event.toolCallId}</p>
            </article>
          )
        }
        return null
      })}
    </div>
  )
}
