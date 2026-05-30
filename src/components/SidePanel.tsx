import { X } from "lucide-react"
import { useOutlineStore } from "../store/OutlineStore"
import { ChatInput } from "./ChatInput"
import { ChatThreadView } from "./ChatThreadView"

export function SidePanel() {
  const { state, dispatch } = useOutlineStore()
  const thread = state.selectedThreadId ? state.threads[state.selectedThreadId] : null
  const node = thread
    ? state.nodes[thread.nodeId]
    : state.focusedNodeId
      ? state.nodes[state.focusedNodeId]
      : null

  if (!state.panelOpen) return null

  return (
    <aside className="side-panel" aria-label="Bullet chat panel">
      <header className="side-panel-header">
        <div>
          <span className="panel-eyebrow">Bullet Chat</span>
          <h2>{node?.text || "No bullet selected"}</h2>
          <p>{node ? node.runStatus : "idle"}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close panel"
          onClick={() => dispatch({ type: "close-panel" })}
        >
          <X size={16} />
        </button>
      </header>
      {thread ? (
        <ChatThreadView messages={thread.messages} events={thread.events} />
      ) : (
        <div className="panel-empty">Execute this bullet to create its chat thread.</div>
      )}
      <ChatInput />
    </aside>
  )
}
