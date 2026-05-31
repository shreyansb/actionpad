import { useCallback, useEffect } from "react"
import { X } from "lucide-react"
import { useOutlineStore } from "../store/OutlineStore"
import { ChatInput } from "./ChatInput"
import { ChatThreadView } from "./ChatThreadView"

function findNodeInput(nodeId: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[data-node-input="${CSS.escape(nodeId)}"]`)
}

export function SidePanel() {
  const { state, dispatch, sendChatMessage } = useOutlineStore()
  const focusedNode = state.focusedNodeId ? state.nodes[state.focusedNodeId] : null
  const selectedThread = state.selectedThreadId ? state.threads[state.selectedThreadId] : null
  const showFocusedEmptyState = Boolean(state.panelOpen && focusedNode && !focusedNode.threadId)
  const thread = showFocusedEmptyState ? null : selectedThread
  const node = showFocusedEmptyState ? focusedNode : thread ? state.nodes[thread.nodeId] : focusedNode

  const closePanelAndRestoreFocus = useCallback(() => {
    const nodeId = state.focusedNodeId
    dispatch({ type: "close-panel" })
    if (nodeId) {
      window.requestAnimationFrame(() => {
        findNodeInput(nodeId)?.focus()
      })
    }
  }, [dispatch, state.focusedNodeId])

  useEffect(() => {
    if (!state.panelOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      closePanelAndRestoreFocus()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [closePanelAndRestoreFocus, state.panelOpen])

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
          onClick={closePanelAndRestoreFocus}
        >
          <X size={16} />
        </button>
      </header>
      {thread ? (
        <ChatThreadView messages={thread.messages} events={thread.events} />
      ) : (
        <div className="panel-empty">Execute this bullet to create its chat thread.</div>
      )}
      <ChatInput
        autoFocusKey={
          state.selectedThreadId ? `${state.selectedThreadId}:${state.chatFocusRequest}` : null
        }
        disabled={!thread || node?.runStatus === "running"}
        onSubmit={(message) => {
          if (thread) sendChatMessage(thread.id, message)
        }}
      />
    </aside>
  )
}
