import { ChevronRight, Loader2, MessageSquare, Play } from "lucide-react"
import type { CSSProperties, KeyboardEvent } from "react"
import { getAdjacentVisibleNodeId } from "../domain/visibleTree"
import type { BulletId } from "../domain/types"
import { useOutlineStore } from "../store/OutlineStore"

type BulletRowProps = {
  nodeId: BulletId
  depth: number
}

let nodeIdSequence = 0

function createNodeId(): BulletId {
  nodeIdSequence += 1
  return `node-${Date.now()}-${nodeIdSequence}`
}

type DepthStyle = CSSProperties & Record<"--depth", number>

export function BulletRow({ nodeId, depth }: BulletRowProps) {
  const { state, dispatch, executeNode } = useOutlineStore()
  const node = state.nodes[nodeId]
  const focused = state.focusedNodeId === nodeId
  const hasChildren = node.children.length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey && event.key === "Enter") {
      event.preventDefault()
      executeNode(nodeId)
      return
    }
    if (event.metaKey && event.key === "ArrowDown") {
      event.preventDefault()
      dispatch({ type: "expand-node", nodeId })
      return
    }
    if (event.metaKey && event.key === "ArrowUp") {
      event.preventDefault()
      dispatch({ type: "collapse-node", nodeId })
      return
    }
    if (event.metaKey && event.key === "ArrowRight") {
      event.preventDefault()
      if (node.threadId) dispatch({ type: "select-thread", threadId: node.threadId })
      dispatch({ type: "open-panel" })
      return
    }
    if (event.metaKey && event.key === "ArrowLeft") {
      event.preventDefault()
      dispatch({ type: "close-panel" })
      return
    }
    if (event.key === "Tab") {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? "outdent-node" : "indent-node", nodeId })
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      dispatch({
        type: "insert-sibling-after",
        afterNodeId: nodeId,
        id: createNodeId(),
        text: "",
      })
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const adjacent = getAdjacentVisibleNodeId(
        state,
        nodeId,
        event.key === "ArrowUp" ? "previous" : "next",
      )
      if (adjacent) {
        event.preventDefault()
        dispatch({ type: "focus-node", nodeId: adjacent })
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(`[data-node-input="${adjacent}"]`)?.focus()
        })
      }
    }
  }

  return (
    <div
      className={`bullet-row ${focused ? "is-focused" : ""}`}
      style={{ "--depth": depth } as DepthStyle}
      data-node-id={nodeId}
      onMouseDown={() => dispatch({ type: "focus-node", nodeId })}
    >
      <button
        className={`bullet-marker ${hasChildren ? "has-children" : ""}`}
        type="button"
        aria-label={node.collapsed ? "Expand bullet" : "Collapse bullet"}
        onClick={() =>
          dispatch({ type: node.collapsed ? "expand-node" : "collapse-node", nodeId })
        }
      >
        {hasChildren ? <ChevronRight className={node.collapsed ? "" : "expanded"} size={16} /> : "•"}
      </button>
      <input
        className="bullet-input"
        data-node-input={nodeId}
        value={node.text}
        onFocus={() => dispatch({ type: "focus-node", nodeId })}
        onChange={(event) =>
          dispatch({ type: "update-text", nodeId, text: event.currentTarget.value })
        }
        onKeyDown={handleKeyDown}
      />
      <div className="row-controls">
        {node.runStatus === "running" ? (
          <Loader2 className="spin" size={16} aria-label="Running" />
        ) : node.threadId ? (
          <button
            className="icon-button"
            type="button"
            aria-label="Open bullet chat"
            onClick={() => {
              dispatch({ type: "select-thread", threadId: node.threadId! })
              dispatch({ type: "open-panel" })
            }}
          >
            <MessageSquare size={15} />
          </button>
        ) : (
          <button
            className="icon-button"
            type="button"
            aria-label="Execute bullet"
            onClick={() => executeNode(nodeId)}
          >
            <Play size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
