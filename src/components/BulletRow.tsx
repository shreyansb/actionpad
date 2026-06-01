import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { CheckCircle2, ChevronRight, CircleHelp, Loader2, MessageSquare } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react"
import { getBulletUnreadState } from "../domain/unread"
import { getAdjacentVisibleNodeId } from "../domain/visibleTree"
import type { AssistantOutcome, BulletMention, FilesystemEntry } from "../domain/runtimeProtocol"
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
  return `[${escapeMarkdownLinkLabel(entry.name)}](<${escapeMarkdownLinkTarget(`@${entry.path}`)}>)`
}

function mentionPathTokenFor(entry: FilesystemEntry): string {
  return `@${entry.path}`
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&")
}

function escapeMarkdownLinkTarget(target: string): string {
  return target.replace(/[\\>]/g, "\\$&")
}

function mentionReplacementEnd(text: string, start: number): number {
  let cursor = start + 1
  while (cursor < text.length && !/\s/.test(text[cursor])) {
    cursor += 1
  }
  return cursor
}

function mentionDisplayLabel(mention: BulletMention): string {
  const label = mention.label.trim()
  if (label) return label
  const segments = mention.path.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? mention.path
}

type MarkdownDisplayPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; mention: BulletMention }
  | { kind: "mentionLink"; label: string; path: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "strong"; text: string }
  | { kind: "emphasis"; text: string }
  | { kind: "code"; text: string }

type ParsedMarkdownToken = Exclude<MarkdownDisplayPart, { kind: "text" } | { kind: "mention" }> & {
  start: number
  end: number
}

function filesystemPathFromMarkdownHref(href: string): string | null {
  if (!href.startsWith("@/")) return null
  return href.slice(1)
}

function parseMarkdownTokenAt(text: string, start: number): ParsedMarkdownToken | null {
  if (text[start] === "`") {
    const end = text.indexOf("`", start + 1)
    if (end > start + 1) return { kind: "code", text: text.slice(start + 1, end), start, end: end + 1 }
  }

  if (text.startsWith("**", start)) {
    const end = text.indexOf("**", start + 2)
    if (end > start + 2) {
      return { kind: "strong", text: text.slice(start + 2, end), start, end: end + 2 }
    }
  }

  if (text[start] === "*" && text[start + 1] !== "*" && text[start - 1] !== "*") {
    const end = text.indexOf("*", start + 1)
    if (end > start + 1 && text[end + 1] !== "*") {
      return { kind: "emphasis", text: text.slice(start + 1, end), start, end: end + 1 }
    }
  }

  if (text[start] === "[") {
    const labelEnd = text.indexOf("](", start + 1)
    if (labelEnd > start + 1) {
      const targetStart = labelEnd + 2
      if (text[targetStart] === "<") {
        const targetEnd = text.indexOf(">)", targetStart + 1)
        if (targetEnd > targetStart + 1) {
          const href = text.slice(targetStart + 1, targetEnd)
          const filesystemPath = filesystemPathFromMarkdownHref(href)
          if (filesystemPath) {
            return {
              kind: "mentionLink",
              label: text.slice(start + 1, labelEnd),
              path: filesystemPath,
              start,
              end: targetEnd + 2,
            }
          }
          return {
            kind: "link",
            label: text.slice(start + 1, labelEnd),
            href,
            start,
            end: targetEnd + 2,
          }
        }
      } else {
        const targetEnd = text.indexOf(")", targetStart)
        if (targetEnd > targetStart) {
          return {
            kind: "link",
            label: text.slice(start + 1, labelEnd),
            href: text.slice(targetStart, targetEnd),
            start,
            end: targetEnd + 1,
          }
        }
      }
    }
  }

  return null
}

function findNextMarkdownToken(text: string, cursor: number): ParsedMarkdownToken | null {
  for (let index = cursor; index < text.length; index += 1) {
    const token = parseMarkdownTokenAt(text, index)
    if (token) return token
  }
  return null
}

function getDisplayParts(text: string, mentions: BulletMention[] | undefined): MarkdownDisplayPart[] {
  const activeMentions = (mentions ?? []).filter((mention) => text.includes(mention.token))
  const parts: MarkdownDisplayPart[] = []
  let cursor = 0

  while (cursor < text.length) {
    const nextMention = activeMentions.reduce<{ mention: BulletMention; index: number } | null>(
      (nearest, mention) => {
        const index = text.indexOf(mention.token, cursor)
        if (index === -1) return nearest
        if (!nearest || index < nearest.index) return { mention, index }
        if (index === nearest.index && mention.token.length > nearest.mention.token.length) {
          return { mention, index }
        }
        return nearest
      },
      null,
    )
    const nextMarkdown = findNextMarkdownToken(text, cursor)
    const useMention =
      nextMention &&
      (!nextMarkdown ||
        nextMention.index < nextMarkdown.start ||
        (nextMention.index === nextMarkdown.start &&
          nextMention.mention.token.length >= nextMarkdown.end - nextMarkdown.start))

    if (!useMention && !nextMarkdown) {
      parts.push({ kind: "text", text: text.slice(cursor) })
      break
    }

    if (useMention && nextMention) {
      if (nextMention.index > cursor) {
        parts.push({ kind: "text", text: text.slice(cursor, nextMention.index) })
      }
      parts.push({ kind: "mention", mention: nextMention.mention })
      cursor = nextMention.index + nextMention.mention.token.length
      continue
    }

    if (!nextMarkdown) break
    const markdownToken = nextMarkdown
    if (markdownToken.start > cursor) {
      parts.push({ kind: "text", text: text.slice(cursor, markdownToken.start) })
    }
    const { start: _start, end, ...part } = markdownToken
    parts.push(part)
    cursor = end
  }

  return parts
}

function hasRichDisplayPart(parts: MarkdownDisplayPart[]): boolean {
  return parts.some((part) => part.kind !== "text")
}

function isSafeMarkdownHref(href: string): boolean {
  return /^(https?:|mailto:|#|\/)/i.test(href)
}

function timestampFromNodeId(nodeId: BulletId): number | null {
  const match = /^(?:node|generated)-(\d{13,})-/.exec(nodeId)
  if (!match) return null
  const timestamp = Number(match[1])
  return Number.isFinite(timestamp) ? timestamp : null
}

function formatBulletTimestamp(timestamp: number | null): string {
  return timestamp === null ? "Unknown" : new Date(timestamp).toLocaleString()
}

function getFirstRunInfo(state: OutlineState, nodeId: BulletId): { createdAt: number; runId: string | null } | null {
  const node = state.nodes[nodeId]
  const thread = node.threadId ? state.threads[node.threadId] : null
  const eventTimestamps =
    thread?.events
      .filter((event) => event.type === "run-started" && event.nodeId === nodeId)
      .map((event) => ({ createdAt: event.createdAt, runId: event.runId ?? null })) ?? []
  const runTimestamps = Object.values(state.runs)
    .filter((run) => run.nodeId === nodeId)
    .map((run) => ({ createdAt: run.createdAt, runId: run.id }))
  const timestamps = [...eventTimestamps, ...runTimestamps].filter((entry) =>
    Number.isFinite(entry.createdAt),
  )

  return timestamps.length > 0
    ? timestamps.sort((left, right) => left.createdAt - right.createdAt)[0]
    : null
}

function getBulletHoverTitle(state: OutlineState, nodeId: BulletId): string {
  const createdAt = timestampFromNodeId(nodeId)
  const firstRun = getFirstRunInfo(state, nodeId)
  const lines = [
    `Created: ${formatBulletTimestamp(createdAt)}`,
    `First run: ${firstRun === null ? "Not run yet" : formatBulletTimestamp(firstRun.createdAt)}`,
  ]

  if (firstRun?.runId) {
    lines.push(`Run ID: ${firstRun.runId}`)
  }

  return lines.join("\n")
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

function hasHiddenRunningDescendant(state: OutlineState, nodeId: BulletId): boolean {
  const node = state.nodes[nodeId]
  return Boolean(node?.collapsed && hasRunningDescendant(state, nodeId))
}

function hasGeneratedChildOutput(state: OutlineState, nodeId: BulletId): boolean {
  const node = state.nodes[nodeId]
  if (!node) return false
  return node.children.some((childId) => state.nodes[childId]?.metadata.generated === true)
}

function getAssistantOutcome(value: unknown): AssistantOutcome | null {
  if (value === "succeeded" || value === "failed" || value === "incomplete") return value
  return null
}

export function BulletRow({ nodeId, depth }: BulletRowProps) {
  const { state, dispatch, executeNode, listFilesystem } = useOutlineStore()
  const node = state.nodes[nodeId]
  const focused = state.focusedNodeId === nodeId
  const hasChildren = node.children.length > 0
  const generated = node.metadata.generated === true
  const unreadState = getBulletUnreadState(state, nodeId)
  const hasUnreadOutput = unreadState !== "none"
  const childRunning = hasHiddenRunningDescendant(state, nodeId)
  const displayParts = useMemo(
    () => getDisplayParts(node.text, node.metadata.mentions),
    [node.metadata.mentions, node.text],
  )
  const showRichDisplay = !focused && hasRichDisplayPart(displayParts)
  const assistantOutcome = getAssistantOutcome(node.metadata.assistantOutcome)
  const showTaskCheckbox = Boolean(node.threadId) && node.metadata.taskCheckboxDeleted !== true
  const taskChecked = showTaskCheckbox && node.metadata.taskChecked === true
  const needsAssistantAttention =
    Boolean(node.threadId) &&
    (assistantOutcome === "incomplete" ||
      assistantOutcome === "failed" ||
      node.runStatus === "failed")
  const completedWithGeneratedOutput =
    node.runStatus === "succeeded" &&
    Boolean(node.threadId) &&
    !needsAssistantAttention &&
    (assistantOutcome === "succeeded" || hasGeneratedChildOutput(state, nodeId))
  const hoverTitle = useMemo(() => getBulletHoverTitle(state, nodeId), [nodeId, state])
  const chatButtonLabel = needsAssistantAttention
    ? assistantOutcome === "failed" || node.runStatus === "failed"
      ? "Open failed bullet chat"
      : "Open incomplete bullet chat"
    : completedWithGeneratedOutput
      ? "Open completed bullet chat"
      : "Open bullet chat"
  const draggable = useDraggable({ id: nodeId })
  const droppable = useDroppable({ id: nodeId })
  const transform = CSS.Translate.toString(draggable.transform)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionPalette, setMentionPalette] = useState<MentionPaletteState | null>(null)
  const [runCommandPalette, setRunCommandPalette] = useState<RunCommandPaletteState | null>(null)
  const [timestampTooltipVisible, setTimestampTooltipVisible] = useState(false)
  const timestampTooltipId = `${nodeId}-timestamp-tooltip`
  const markerTooltipProps = {
    "aria-describedby": timestampTooltipVisible ? timestampTooltipId : undefined,
    onMouseEnter: () => setTimestampTooltipVisible(true),
    onMouseLeave: () => setTimestampTooltipVisible(false),
  }

  useEffect(() => {
    if (unreadState === "self") {
      dispatch({ type: "mark-node-viewed", nodeId })
    }
  }, [dispatch, nodeId, unreadState])

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
    const token = `${mentionPathTokenFor(entry)}/`
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
      event.key === "Backspace" &&
      showTaskCheckbox &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault()
      dispatch({ type: "delete-task-checkbox", nodeId })
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
      className={`bullet-row ${focused ? "is-focused" : ""} ${generated ? "is-generated" : ""} ${showTaskCheckbox ? "has-task-checkbox" : ""} ${taskChecked ? "is-task-checked" : ""} ${droppable.isOver ? "is-drop-target" : ""}`}
      style={{ "--depth": depth, transform } as DepthStyle}
      data-node-id={nodeId}
      onMouseDown={handleRowMouseDown}
    >
      {hasChildren ? (
        <button
          className="bullet-marker has-children"
          type="button"
          aria-label={node.collapsed ? "Expand bullet" : "Collapse bullet"}
          {...markerTooltipProps}
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
          {...markerTooltipProps}
          {...draggable.listeners}
          {...draggable.attributes}
          tabIndex={-1}
          onFocus={focusNode}
          onMouseDown={focusNode}
        >
          <span aria-hidden="true">•</span>
        </span>
      )}
      {timestampTooltipVisible ? (
        <BulletTimestampTooltip id={timestampTooltipId} title={hoverTitle} />
      ) : null}
      <div className={`bullet-content ${showTaskCheckbox ? "has-task-checkbox" : ""}`}>
        {showTaskCheckbox ? (
          <span className="task-checkbox-slot">
            <input
              className="task-checkbox"
              type="checkbox"
              aria-label={`Task complete: ${node.text || "empty bullet"}`}
              checked={taskChecked}
              tabIndex={focused ? 0 : -1}
              onFocus={focusNode}
              onChange={(event) => {
                dispatch({ type: "set-task-checked", nodeId, checked: event.currentTarget.checked })
              }}
            />
          </span>
        ) : null}
        <textarea
          ref={textAreaRef}
          className={`bullet-input ${showRichDisplay ? "has-display-overlay" : ""}`}
          data-node-input={nodeId}
          aria-label={`Bullet text: ${node.text || "empty bullet"}`}
          value={node.text}
          rows={1}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onFocus={focusNode}
          onChange={(event) => {
            const nextText = event.currentTarget.value
            dispatch({ type: "update-text", nodeId, text: nextText })
            updateMentionPaletteForInput(event.currentTarget, nextText)
          }}
          onKeyDown={handleKeyDown}
        />
        {showRichDisplay ? (
          <div
            className="bullet-display"
            onMouseDown={(event) => {
              if (event.target instanceof Element && event.target.closest("a")) return
              focusNode()
              focusNodeInputAfterRender(nodeId)
            }}
          >
            {displayParts.map((part, index) => {
              if (part.kind === "mention") {
                return (
                  <span
                    key={`${part.mention.id}-${index}`}
                    className="mention-chip"
                    title={part.mention.path}
                  >
                    {mentionDisplayLabel(part.mention)}
                  </span>
                )
              }
              if (part.kind === "link") {
                return (
                  <a
                    key={`link-${index}`}
                    className="markdown-link"
                    href={isSafeMarkdownHref(part.href) ? part.href : undefined}
                  >
                    {part.label}
                  </a>
                )
              }
              if (part.kind === "mentionLink") {
                return (
                  <span key={`mention-link-${index}`} className="mention-chip" title={part.path}>
                    {part.label}
                  </span>
                )
              }
              if (part.kind === "strong") {
                return (
                  <strong key={`strong-${index}`} className="markdown-strong">
                    {part.text}
                  </strong>
                )
              }
              if (part.kind === "emphasis") {
                return (
                  <em key={`emphasis-${index}`} className="markdown-emphasis">
                    {part.text}
                  </em>
                )
              }
              if (part.kind === "code") {
                return (
                  <code key={`code-${index}`} className="markdown-code">
                    {part.text}
                  </code>
                )
              }
              return <span key={`text-${index}`}>{part.text}</span>
            })}
          </div>
        ) : null}
      </div>
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
        {hasUnreadOutput ? (
          <span className="unread-dot" role="img" aria-label="Unread output" />
        ) : null}
        {node.runStatus === "running" ? (
          <Loader2 className="spin" size={16} aria-label="Running" />
        ) : childRunning ? (
          <Loader2 className="spin" size={16} aria-label="Child running" />
        ) : node.threadId ? (
          <button
            className={`icon-button ${completedWithGeneratedOutput ? "is-complete" : ""} ${needsAssistantAttention ? "is-incomplete" : ""}`}
            type="button"
            aria-label={chatButtonLabel}
            tabIndex={focused ? 0 : -1}
            onFocus={focusNode}
            onClick={() => {
              openThreadPanel()
            }}
          >
            {needsAssistantAttention ? (
              <CircleHelp size={16} />
            ) : completedWithGeneratedOutput ? (
              <CheckCircle2 size={16} />
            ) : (
              <MessageSquare size={15} />
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function BulletTimestampTooltip({ id, title }: { id: string; title: string }) {
  return (
    <div
      id={id}
      className="run-command-palette bullet-timestamp-tooltip"
      role="tooltip"
    >
      {title.split("\n").map((line) => {
        const separatorIndex = line.indexOf(": ")
        const label = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
        const detail = separatorIndex === -1 ? "" : line.slice(separatorIndex + 2)

        return (
          <div key={label} className="run-command-option bullet-timestamp-tooltip-row">
            <span className="run-command-option-label">{label}</span>
            <span className="run-command-option-detail">{detail}</span>
          </div>
        )
      })}
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
