import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { ChevronRight, Loader2, MessageSquare, Play } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
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

function findNodeInput(nodeId: BulletId): HTMLTextAreaElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLTextAreaElement>("[data-node-input]")).find(
      (input) => input.dataset.nodeInput === nodeId,
    ) ?? null
  )
}

type DepthStyle = CSSProperties & Record<"--depth", number>

export function BulletRow({ nodeId, depth }: BulletRowProps) {
  const { state, dispatch, executeNode } = useOutlineStore()
  const node = state.nodes[nodeId]
  const focused = state.focusedNodeId === nodeId
  const hasChildren = node.children.length > 0
  const generated = node.metadata.generated === true
  const draggable = useDraggable({ id: nodeId })
  const droppable = useDroppable({ id: nodeId })
  const transform = CSS.Translate.toString(draggable.transform)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const textArea = textAreaRef.current
    if (!textArea) return
    textArea.style.height = "auto"
    textArea.style.height = `${textArea.scrollHeight}px`
  }, [node.text])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault()
      dispatch({
        type: "move-node",
        nodeId,
        direction: event.key === "ArrowUp" ? "up" : "down",
      })
      window.requestAnimationFrame(() => {
        findNodeInput(nodeId)?.focus()
      })
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const newNodeId = createNodeId()
      dispatch({
        type: "insert-sibling-after",
        afterNodeId: nodeId,
        id: newNodeId,
        text: "",
      })
      window.requestAnimationFrame(() => {
        findNodeInput(newNodeId)?.focus()
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
          findNodeInput(adjacent)?.focus()
        })
      }
    }
  }

  return (
    <div
      ref={(element) => {
        draggable.setNodeRef(element)
        droppable.setNodeRef(element)
      }}
      className={`bullet-row ${focused ? "is-focused" : ""} ${generated ? "is-generated" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
      style={{ "--depth": depth, transform } as DepthStyle}
      data-node-id={nodeId}
      onMouseDown={() => dispatch({ type: "focus-node", nodeId })}
    >
      {hasChildren ? (
        <button
          className="bullet-marker has-children"
          type="button"
          aria-label={node.collapsed ? "Expand bullet" : "Collapse bullet"}
          onFocus={() => dispatch({ type: "focus-node", nodeId })}
          onClick={() =>
            dispatch({ type: node.collapsed ? "expand-node" : "collapse-node", nodeId })
          }
          {...draggable.listeners}
          {...draggable.attributes}
        >
          <ChevronRight className={node.collapsed ? "" : "expanded"} size={16} />
        </button>
      ) : (
        <span
          className="bullet-marker bullet-marker-leaf"
          aria-label="Drag bullet"
          {...draggable.listeners}
          {...draggable.attributes}
          tabIndex={-1}
          onFocus={() => dispatch({ type: "focus-node", nodeId })}
          onMouseDown={() => dispatch({ type: "focus-node", nodeId })}
        >
          <span aria-hidden="true">•</span>
        </span>
      )}
      <textarea
        ref={textAreaRef}
        className="bullet-input"
        data-node-input={nodeId}
        aria-label={`Bullet text: ${node.text || "empty bullet"}`}
        value={node.text}
        rows={1}
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
            tabIndex={focused ? 0 : -1}
            onFocus={() => dispatch({ type: "focus-node", nodeId })}
            onClick={() => {
              dispatch({ type: "select-thread", threadId: node.threadId! })
              dispatch({ type: "open-panel" })
            }}
          >
            <MessageSquare size={15} />
          </button>
        ) : (
          <>
            {generated ? <span className="row-badge">generated</span> : null}
            <button
              className="icon-button"
              type="button"
              aria-label="Execute bullet"
              tabIndex={focused ? 0 : -1}
              onFocus={() => dispatch({ type: "focus-node", nodeId })}
              onClick={() => executeNode(nodeId)}
            >
              <Play size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
