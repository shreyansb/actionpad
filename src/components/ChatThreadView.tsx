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
      {events
        .filter((event) => event.type === "outline-output")
        .map((event, index) => (
          <article key={`${event.createdAt}-${index}`} className="event-card">
            <strong>Outline output</strong>
            {"output" in event && event.output.type === "append-child-bullets" ? (
              <p>Appended {event.output.bullets.length} child bullets.</p>
            ) : (
              <p>Updated outline state.</p>
            )}
          </article>
        ))}
    </div>
  )
}
