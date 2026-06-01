import { useCallback, useEffect } from "react"
import { Play, Square, X } from "lucide-react"
import { useOutlineStore } from "../store/OutlineStore"
import { ChatInput } from "./ChatInput"
import { ChatThreadView } from "./ChatThreadView"

function findNodeInput(nodeId: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[data-node-input="${CSS.escape(nodeId)}"]`)
}

export function SidePanel() {
  const { state, dispatch, executeNode, sendChatMessage, cancelRun } = useOutlineStore()
  const focusedNode = state.focusedNodeId ? state.nodes[state.focusedNodeId] : null
  const selectedThread = state.selectedThreadId ? state.threads[state.selectedThreadId] : null
  const focusedThread = focusedNode?.threadId ? state.threads[focusedNode.threadId] : null
  const thread = state.panelOpen && focusedNode ? focusedThread : selectedThread
  const node = focusedNode ?? (thread ? state.nodes[thread.nodeId] : null)
  const activeRunId = node?.runStatus === "running" ? node.activeRunId : undefined
  const displayedRunId = activeRunId ?? thread?.runs.at(-1) ?? null
  const chatAutoFocusKey =
    thread && state.selectedThreadId === thread.id ? `${thread.id}:${state.chatFocusRequest}` : null

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
          <div className="side-panel-meta">
            <span>{node ? node.runStatus : "idle"}</span>
            {displayedRunId ? (
              <span className="side-panel-run-id">
                <span>Run ID</span>
                <code>{displayedRunId}</code>
              </span>
            ) : null}
          </div>
        </div>
        <div className="side-panel-header-actions">
          {activeRunId ? (
            <button
              type="button"
              className="icon-button is-danger"
              aria-label="Stop run"
              onClick={() => cancelRun(activeRunId)}
            >
              <Square size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Close panel"
            onClick={closePanelAndRestoreFocus}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {thread ? (
        <ChatThreadView messages={thread.messages} events={thread.events} />
      ) : (
        <div className="panel-empty">
          <p>No chat yet.</p>
          {node ? (
            <button
              type="button"
              className="panel-empty-action"
              disabled={node.runStatus === "running"}
              onClick={() => executeNode(node.id)}
            >
              <Play size={13} />
              Run this bullet
            </button>
          ) : null}
        </div>
      )}
      {thread ? (
        <ChatInput
          autoFocusKey={chatAutoFocusKey}
          disabled={node?.runStatus === "running"}
          onSubmit={(message) => {
            sendChatMessage(thread.id, message)
          }}
        />
      ) : null}
    </aside>
  )
}
