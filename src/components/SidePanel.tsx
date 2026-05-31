import { useCallback, useEffect, useState } from "react"
import { Play, X } from "lucide-react"
import { useOutlineStore } from "../store/OutlineStore"
import { ChatInput } from "./ChatInput"
import { ChatThreadView } from "./ChatThreadView"

function codexResumeCommand(providerThreadId: string): string {
  return `codex resume ${providerThreadId}`
}

function findNodeInput(nodeId: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[data-node-input="${CSS.escape(nodeId)}"]`)
}

export function SidePanel() {
  const { state, dispatch, executeNode, sendChatMessage } = useOutlineStore()
  const focusedNode = state.focusedNodeId ? state.nodes[state.focusedNodeId] : null
  const selectedThread = state.selectedThreadId ? state.threads[state.selectedThreadId] : null
  const focusedThread = focusedNode?.threadId ? state.threads[focusedNode.threadId] : null
  const thread = state.panelOpen && focusedNode ? focusedThread : selectedThread
  const node = focusedNode ?? (thread ? state.nodes[thread.nodeId] : null)
  const codexCommand = thread?.providerThreadId ? codexResumeCommand(thread.providerThreadId) : null
  const chatAutoFocusKey =
    thread && state.selectedThreadId === thread.id ? `${thread.id}:${state.chatFocusRequest}` : null
  const [copiedCodexCommand, setCopiedCodexCommand] = useState(false)

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

  useEffect(() => {
    setCopiedCodexCommand(false)
  }, [codexCommand])

  if (!state.panelOpen) return null

  return (
    <aside className="side-panel" aria-label="Bullet chat panel">
      <header className="side-panel-header">
        <div>
          <span className="panel-eyebrow">Bullet Chat</span>
          <h2>{node?.text || "No bullet selected"}</h2>
          {codexCommand ? (
            <button
              type="button"
              className="panel-codex-command"
              title={codexCommand}
              onClick={() => {
                void navigator.clipboard?.writeText(codexCommand)
                setCopiedCodexCommand(true)
              }}
            >
              {copiedCodexCommand ? "Copied Codex resume command" : "Copy Codex resume command"}
            </button>
          ) : null}
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
