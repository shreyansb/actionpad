import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { CheckCircle2, ChevronRight, Loader2, MessageSquare } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react"
import { getBulletUnreadState } from "../domain/unread"
import { getAdjacentVisibleNodeId } from "../domain/visibleTree"
import type { BulletMention, FilesystemEntry } from "../domain/runtimeProtocol"
import type { BulletId, OutlineState } from "../domain/types"
import { useOutlineStore } from "../store/OutlineStore"

type BulletRowProps = {
  nodeId: BulletId
  depth: number
}

let nodeIdSequence = 0
let mentionIdSequence = 0

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

function shouldMoveToAdjacentBullet(input: HTMLTextAreaElement, key: "ArrowUp" | "ArrowDown") {
  if (input.selectionStart !== input.selectionEnd) return false
  if (key === "ArrowUp") return input.selectionStart === 0
  return input.selectionEnd === input.value.length
}

function createMentionId(): string {
  mentionIdSequence += 1
  return `mention-${Date.now()}-${mentionIdSequence}`
}

function getMentionTrigger(text: string, caret: number): { start: number; query: string } | null {
  const beforeCaret = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
  if (!match) return null
  const tokenPath = match[2]
  const lastSlashIndex = tokenPath.lastIndexOf("/")
  return {
    start: beforeCaret.length - tokenPath.length - 1,
    query: tokenPath.slice(lastSlashIndex + 1),
  }
}

function mentionTokenFor(entry: FilesystemEntry): string {
  return `@${entry.path}`
}

function mentionReplacementEnd(text: string, start: number): number {
  let cursor = start + 1
  while (cursor < text.length && !/\s/.test(text[cursor])) {
    cursor += 1
  }
  return cursor
}

function rankMentionEntry(entry: FilesystemEntry, query: string): number {
  const name = entry.name.toLowerCase()
  if (!query) return 0
  if (name.startsWith(query)) return 0
  return 1
}

type MentionPaletteState = {
  triggerStart: number
  query: string
  folderPath: string | null
  currentPath: string | null
  parentPath: string | null
  entries: FilesystemEntry[]
  selectedIndex: number
  loading: boolean
  error: string | null
}

type RunCommandId = "now" | "after" | "at"

type RunCommandPaletteState = {
  selectedIndex: number
}

type RunCommandOption = {
  id: RunCommandId
  label: string
  detail: string
}

type DepthStyle = CSSProperties & Record<"--depth", number>

function hasRunningDescendant(state: OutlineState, nodeId: BulletId): boolean {
  const node = state.nodes[nodeId]
  if (!node) return false
  return node.children.some((childId) => {
    const child = state.nodes[childId]
    if (!child) return false
    return child.runStatus === "running" || hasRunningDescendant(state, childId)
  })
}

function hasGeneratedChildOutput(state: OutlineState, nodeId: BulletId): boolean {
  const node = state.nodes[nodeId]
  if (!node) return false
  return node.children.some((childId) => state.nodes[childId]?.metadata.generated === true)
}

export function BulletRow({ nodeId, depth }: BulletRowProps) {
  const { state, dispatch, executeNode, listFilesystem } = useOutlineStore()
  const node = state.nodes[nodeId]
  const focused = state.focusedNodeId === nodeId
  const hasChildren = node.children.length > 0
  const generated = node.metadata.generated === true
  const unreadState = getBulletUnreadState(state, nodeId)
  const childRunning = hasRunningDescendant(state, nodeId)
  const completedWithGeneratedOutput =
    node.runStatus === "succeeded" && Boolean(node.threadId) && hasGeneratedChildOutput(state, nodeId)
  const draggable = useDraggable({ id: nodeId })
  const droppable = useDroppable({ id: nodeId })
  const transform = CSS.Translate.toString(draggable.transform)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionPalette, setMentionPalette] = useState<MentionPaletteState | null>(null)
  const [runCommandPalette, setRunCommandPalette] = useState<RunCommandPaletteState | null>(null)

  const afterTarget = useMemo(() => {
    const parent = node.parentId ? state.nodes[node.parentId] : null
    if (!parent) return null
    const siblingIndex = parent.children.indexOf(nodeId)
    if (siblingIndex > 0) return { id: parent.children[siblingIndex - 1], kind: "previous" as const }
    return { id: parent.id, kind: "parent" as const }
  }, [node.parentId, nodeId, state.nodes])

  const runCommandOptions = useMemo<RunCommandOption[]>(
    () => [
      {
        id: "now",
        label: "Run now",
        detail: "Start this bullet immediately.",
      },
      {
        id: "after",
        label: afterTarget?.kind === "parent" ? "Run after parent" : "Run after previous",
        detail: afterTarget
          ? `Start when the ${afterTarget.kind} bullet is finished.`
          : "No parent or previous bullet is available yet.",
      },
      {
        id: "at",
        label: "Run at...",
        detail: "Schedule this bullet for a specific time.",
      },
    ],
    [afterTarget],
  )

  const filteredMentionEntries = useMemo(() => {
    if (!mentionPalette) return []
    const query = mentionPalette.query.toLowerCase()
    if (!query) return mentionPalette.entries
    return mentionPalette.entries
      .filter((entry) => entry.name.toLowerCase().includes(query))
      .sort((a, b) => rankMentionEntry(a, query) - rankMentionEntry(b, query))
  }, [mentionPalette])

  useLayoutEffect(() => {
    const textArea = textAreaRef.current
    if (!textArea) return
    textArea.style.height = "auto"
    textArea.style.height = `${textArea.scrollHeight}px`
  }, [node.text])

  useEffect(() => {
    if (!mentionPalette) return
    let cancelled = false

    setMentionPalette((current) => (current ? { ...current, loading: true, error: null } : current))
    listFilesystem(mentionPalette.folderPath, mentionPalette.query)
      .then((listed) => {
        if (cancelled) return
        setMentionPalette((current) =>
          current
            ? {
                ...current,
                currentPath: listed.path,
                parentPath: listed.parentPath,
                entries: listed.entries,
                selectedIndex: 0,
                loading: false,
                error: null,
              }
            : current,
        )
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : "Could not list files."
        setMentionPalette((current) =>
          current ? { ...current, entries: [], selectedIndex: 0, loading: false, error: message } : current,
        )
      })

    return () => {
      cancelled = true
    }
  }, [listFilesystem, mentionPalette?.folderPath, mentionPalette?.query])

  function focusNode() {
    if (!focused) dispatch({ type: "focus-node", nodeId })
  }

  function runSelectedCommand(commandId: RunCommandId) {
    setRunCommandPalette(null)
    if (commandId === "now") {
      executeNode(nodeId)
      return
    }
    focusNodeInputAfterRender(nodeId)
  }

  function openThreadPanel() {
    if (node.threadId) {
      dispatch({ type: "select-thread", threadId: node.threadId, seenAt: Date.now() })
      dispatch({ type: "request-chat-focus" })
    }
    dispatch({ type: "open-panel" })
  }

  function handleRowMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLTextAreaElement) return
    focusNode()
  }

  function updateMentionPaletteForInput(input: HTMLTextAreaElement, text: string) {
    setRunCommandPalette(null)
    const trigger = getMentionTrigger(text, input.selectionStart)
    if (!trigger) {
      setMentionPalette(null)
      return
    }

    setMentionPalette((current) => ({
      triggerStart: trigger.start,
      query: trigger.query,
      folderPath: current?.folderPath ?? null,
      currentPath: current?.currentPath ?? null,
      parentPath: current?.parentPath ?? null,
      entries: current?.entries ?? [],
      selectedIndex: 0,
      loading: current?.loading ?? false,
      error: current?.error ?? null,
    }))
  }

  function insertMention(entry: FilesystemEntry, input: HTMLTextAreaElement) {
    if (!mentionPalette) return
    const token = mentionTokenFor(entry)
    const currentText = input.value
    const replacementEnd = mentionReplacementEnd(currentText, mentionPalette.triggerStart)
    const nextText = `${currentText.slice(0, mentionPalette.triggerStart)}${token} ${currentText.slice(replacementEnd)}`
    const mention: BulletMention = {
      id: createMentionId(),
      kind: entry.kind,
      path: entry.path,
      label: entry.name,
      token,
      createdAt: Date.now(),
    }

    dispatch({ type: "update-text", nodeId, text: nextText })
    dispatch({ type: "attach-mention", nodeId, mention })
    setMentionPalette(null)
    window.requestAnimationFrame(() => {
      const nextInput = findNodeInput(nodeId)
      nextInput?.focus()
      const caret = mentionPalette.triggerStart + token.length + 1
      nextInput?.setSelectionRange(caret, caret)
    })
  }

  function enterMentionFolder(entry: FilesystemEntry, input: HTMLTextAreaElement) {
    if (!mentionPalette || entry.kind !== "folder") return
    const token = `${mentionTokenFor(entry)}/`
    const currentText = input.value
    const replacementEnd = mentionReplacementEnd(currentText, mentionPalette.triggerStart)
    const nextText = `${currentText.slice(0, mentionPalette.triggerStart)}${token}${currentText.slice(replacementEnd)}`
    dispatch({ type: "update-text", nodeId, text: nextText })
    setMentionPalette((current) =>
      current
        ? {
            ...current,
            folderPath: entry.path,
            currentPath: entry.path,
            query: "",
            entries: [],
            selectedIndex: 0,
            loading: true,
            error: null,
          }
        : current,
    )
    window.requestAnimationFrame(() => {
      const nextInput = findNodeInput(nodeId)
      nextInput?.focus()
      const caret = mentionPalette.triggerStart + token.length
      nextInput?.setSelectionRange(caret, caret)
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const hasSelectionModifier = event.shiftKey || event.ctrlKey

    if (runCommandPalette) {
      if (event.key === "Escape") {
        event.preventDefault()
        setRunCommandPalette(null)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        setRunCommandPalette((current) => {
          if (!current) return current
          const delta = event.key === "ArrowDown" ? 1 : -1
          return {
            selectedIndex: (current.selectedIndex + delta + runCommandOptions.length) % runCommandOptions.length,
          }
        })
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        runSelectedCommand(runCommandOptions[runCommandPalette.selectedIndex].id)
        return
      }
    }

    if (mentionPalette) {
      if (event.key === "Escape") {
        event.preventDefault()
        setMentionPalette(null)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        setMentionPalette((current) => {
          if (!current) return current
          const count = filteredMentionEntries.length
          if (count === 0) return current
          const delta = event.key === "ArrowDown" ? 1 : -1
          return { ...current, selectedIndex: (current.selectedIndex + delta + count) % count }
        })
        return
      }
      if (event.key === "ArrowRight") {
        const selected = filteredMentionEntries[mentionPalette.selectedIndex]
        if (selected?.kind === "folder") {
          event.preventDefault()
          enterMentionFolder(selected, event.currentTarget)
          return
        }
      }
      if (event.key === "ArrowLeft") {
        if (mentionPalette.parentPath && mentionPalette.parentPath !== mentionPalette.currentPath) {
          event.preventDefault()
          setMentionPalette((current) =>
            current
              ? {
                  ...current,
                  folderPath: current.parentPath,
                  query: "",
                  selectedIndex: 0,
                  entries: [],
                }
              : current,
          )
          return
        }
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const selected = filteredMentionEntries[mentionPalette.selectedIndex]
        if (event.key === "Tab" && selected?.kind === "folder") {
          event.preventDefault()
          enterMentionFolder(selected, event.currentTarget)
          return
        }
        if (selected) {
          event.preventDefault()
          insertMention(selected, event.currentTarget)
          return
        }
      }
    }

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
      setMentionPalette(null)
      if (node.threadId) {
        setRunCommandPalette(null)
        openThreadPanel()
        return
      }
      setRunCommandPalette({ selectedIndex: 0 })
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
    if (
      event.metaKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault()
      dispatch({
        type: "move-node-at-same-depth",
        nodeId,
        direction: event.key === "ArrowUp" ? "up" : "down",
      })
      window.requestAnimationFrame(() => {
        findNodeInput(nodeId)?.focus()
      })
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
      if (hasChildren && !node.collapsed) {
        dispatch({
          type: "insert-first-child",
          parentId: nodeId,
          id: newNodeId,
          text: "",
        })
      } else {
        dispatch({
          type: "insert-sibling-after",
          afterNodeId: nodeId,
          id: newNodeId,
          text: "",
        })
      }
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
      if (!shouldMoveToAdjacentBullet(event.currentTarget, event.key)) return

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
      className={`bullet-row ${focused ? "is-focused" : ""} ${generated ? "is-generated" : ""} ${unreadState === "self" ? "has-unread-self" : ""} ${unreadState === "descendant" ? "has-unread-descendant" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
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
        onChange={(event) => {
          const nextText = event.currentTarget.value
          dispatch({ type: "update-text", nodeId, text: nextText })
          updateMentionPaletteForInput(event.currentTarget, nextText)
        }}
        onKeyDown={handleKeyDown}
      />
      {mentionPalette ? (
        <MentionPalette
          entries={filteredMentionEntries}
          loading={mentionPalette.loading}
          error={mentionPalette.error}
          selectedIndex={mentionPalette.selectedIndex}
        />
      ) : null}
      {runCommandPalette ? (
        <RunCommandPalette
          options={runCommandOptions}
          selectedIndex={runCommandPalette.selectedIndex}
        />
      ) : null}
      <div className="row-controls">
        {node.runStatus === "running" ? (
          <Loader2 className="spin" size={16} aria-label="Running" />
        ) : childRunning ? (
          <Loader2 className="spin" size={16} aria-label="Child running" />
        ) : node.threadId ? (
          <button
            className={`icon-button ${completedWithGeneratedOutput ? "is-complete" : ""}`}
            type="button"
            aria-label={completedWithGeneratedOutput ? "Open completed bullet chat" : "Open bullet chat"}
            tabIndex={focused ? 0 : -1}
            onFocus={focusNode}
            onClick={() => {
              openThreadPanel()
            }}
          >
            {completedWithGeneratedOutput ? <CheckCircle2 size={16} /> : <MessageSquare size={15} />}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function RunCommandPalette({
  options,
  selectedIndex,
}: {
  options: RunCommandOption[]
  selectedIndex: number
}) {
  return (
    <div className="run-command-palette" role="listbox" aria-label="Run command palette">
      {options.map((option, index) => (
        <div
          key={option.id}
          className={`run-command-option ${index === selectedIndex ? "is-selected" : ""}`}
          role="option"
          aria-selected={index === selectedIndex}
          aria-label={option.label}
        >
          <span className="run-command-option-label">{option.label}</span>
          <span className="run-command-option-detail">{option.detail}</span>
        </div>
      ))}
    </div>
  )
}

function MentionPalette({
  entries,
  loading,
  error,
  selectedIndex,
}: {
  entries: FilesystemEntry[]
  loading: boolean
  error: string | null
  selectedIndex: number
}) {
  return (
    <div className="mention-palette" role="listbox" aria-label="Filesystem mentions">
      {loading ? <div className="mention-palette-status">Loading...</div> : null}
      {error ? <div className="mention-palette-status">{error}</div> : null}
      {!loading && !error && entries.length === 0 ? (
        <div className="mention-palette-status">No matches</div>
      ) : null}
      {entries.map((entry, index) => (
        <div
          key={entry.path}
          className={`mention-option ${index === selectedIndex ? "is-selected" : ""}`}
          role="option"
          aria-selected={index === selectedIndex}
          aria-label={`${entry.name} ${entry.kind}`}
        >
          <span className="mention-option-name">{entry.name}</span>
          <span className="mention-option-kind">{entry.kind}</span>
        </div>
      ))}
    </div>
  )
}
