import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { ChevronRight, Loader2, MessageSquare } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react"
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

function focusNodeInputAfterRender(nodeId: BulletId) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      findNodeInput(nodeId)?.focus()
    })
  })
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

  function focusNode() {
    if (!focused) dispatch({ type: "focus-node", nodeId })
  }

  function handleRowMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLTextAreaElement) return
    focusNode()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const hasSelectionModifier = event.shiftKey || event.ctrlKey

    if (
      event.metaKey &&
      !event.altKey &&
      !hasSelectionModifier &&
      event.key.toLowerCase() === "z" &&
      state.undoStack.length > 0
    ) {
      const restoredNodeId = state.undoStack[state.undoStack.length - 1]?.focusedNodeId
      event.preventDefault()
      dispatch({ type: "undo" })
      if (restoredNodeId) {
        focusNodeInputAfterRender(restoredNodeId)
      }
      return
    }
    if (event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "Enter") {
      event.preventDefault()
      executeNode(nodeId)
      return
    }
    if (event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "ArrowDown") {
      event.preventDefault()
      dispatch({ type: "expand-node", nodeId })
      return
    }
    if (event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "ArrowUp") {
      event.preventDefault()
      dispatch({ type: "collapse-node", nodeId })
      return
    }
    if (event.key === "Tab") {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? "outdent-node" : "indent-node", nodeId })
      return
    }
    if (
      event.altKey &&
      !event.metaKey &&
      !hasSelectionModifier &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
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
    if (!event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "Enter") {
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
    if (
      !event.metaKey &&
      !event.altKey &&
      !hasSelectionModifier &&
      (event.key === "Backspace" || event.key === "Delete") &&
      node.text.length === 0 &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      const focusTarget =
        event.key === "Backspace"
          ? (getAdjacentVisibleNodeId(state, nodeId, "previous") ??
            getAdjacentVisibleNodeId(state, nodeId, "next"))
          : (getAdjacentVisibleNodeId(state, nodeId, "next") ??
            getAdjacentVisibleNodeId(state, nodeId, "previous"))

      event.preventDefault()
      dispatch({ type: "delete-node", nodeId, focusNodeId: focusTarget })
      if (focusTarget) {
        focusNodeInputAfterRender(focusTarget)
      }
      return
    }
    if (
      !event.metaKey &&
      !event.altKey &&
      !hasSelectionModifier &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      const adjacent = getAdjacentVisibleNodeId(
        state,
        nodeId,
        event.key === "ArrowUp" ? "previous" : "next",
      )
      if (adjacent) {
        event.preventDefault()
        dispatch({ type: "focus-node", nodeId: adjacent })
        focusNodeInputAfterRender(adjacent)
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
      onMouseDown={handleRowMouseDown}
    >
      {hasChildren ? (
        <button
          className="bullet-marker has-children"
          type="button"
          aria-label={node.collapsed ? "Expand bullet" : "Collapse bullet"}
          onFocus={focusNode}
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
          onFocus={focusNode}
          onMouseDown={focusNode}
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
        onFocus={focusNode}
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
            onFocus={focusNode}
            onClick={() => {
              dispatch({ type: "select-thread", threadId: node.threadId! })
              dispatch({ type: "open-panel" })
            }}
          >
            <MessageSquare size={15} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
