import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { CheckCircle2, ChevronRight, CircleHelp, Loader2, MessageSquare } from "lucide-react"
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent, MouseEvent, MutableRefObject } from "react"
import type { BulletUnreadState } from "../domain/unread"
import type { AssistantOutcome, BulletMention, FilesystemEntry } from "../domain/runtimeProtocol"
import type { BulletId, BulletNode } from "../domain/types"
import { measureInteractionToPaint, measurePerf } from "../perf"
import { useOutlineActions } from "../store/OutlineActionsContext"

type BulletRowProps = {
  node: BulletNode
  depth: number
  focused: boolean
  previousVisibleNodeId: BulletId | null
  nextVisibleNodeId: BulletId | null
  unreadState: BulletUnreadState
  unreadDescendantPath: BulletId[] | null
  hiddenRunningDescendantCount: number
  hasGeneratedChildOutput: boolean
  hoverTitle: string
}

export type BulletRowUndoState = {
  hasUndo: boolean
  hasRedo: boolean
  nextUndoFocusedNodeId: BulletId | null
  nextRedoFocusedNodeId: BulletId | null
}

export const BulletRowUndoStateContext =
  createContext<MutableRefObject<BulletRowUndoState> | null>(null)

export const bulletRowRenderCounts =
  import.meta.env.MODE === "test" ? new Map<BulletId, number>() : null

export function getBulletRowRenderCount(nodeId: BulletId): number {
  return bulletRowRenderCounts?.get(nodeId) ?? 0
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

function focusNodeInputAfterRender(nodeId: BulletId, caret?: number) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const input = findNodeInput(nodeId)
      input?.focus()
      if (input && caret !== undefined) {
        input.setSelectionRange(caret, caret)
      }
    })
  })
}

type TextLinePosition = {
  start: number
  end: number
  index: number
  count: number
  column: number
}

type SlashCommandId = "today" | "yesterday" | "tomorrow"

type SlashCommand = {
  id: SlashCommandId
  label: string
  detail: string
  offsetDays: number
}

const slashCommands: SlashCommand[] = [
  { id: "today", label: "/today", detail: "Insert today's date", offsetDays: 0 },
  { id: "yesterday", label: "/yesterday", detail: "Insert yesterday's date", offsetDays: -1 },
  { id: "tomorrow", label: "/tomorrow", detail: "Insert tomorrow's date", offsetDays: 1 },
]

const weekdayLabels = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"]
const monthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

type SlashCommandMenuState = {
  triggerStart: number
  query: string
  selectedIndex: number
}

let verticalNavigationColumn: number | null = null

function resetVerticalNavigationColumn() {
  verticalNavigationColumn = null
}

function getTextLinePosition(text: string, offset: number): TextLinePosition {
  const lineStarts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") lineStarts.push(index + 1)
  }

  const boundedOffset = Math.max(0, Math.min(offset, text.length))
  for (let index = 0; index < lineStarts.length; index += 1) {
    const start = lineStarts[index]
    const nextStart = lineStarts[index + 1]
    const end = nextStart === undefined ? text.length : nextStart - 1
    if (boundedOffset <= end || index === lineStarts.length - 1) {
      return {
        start,
        end,
        index,
        count: lineStarts.length,
        column: boundedOffset - start,
      }
    }
  }

  return { start: 0, end: text.length, index: 0, count: 1, column: boundedOffset }
}

function getBoundaryLineColumn(input: HTMLTextAreaElement, key: "ArrowUp" | "ArrowDown") {
  if (input.selectionStart !== input.selectionEnd) return null
  const position = getTextLinePosition(input.value, input.selectionStart)
  if (key === "ArrowUp" && position.index !== 0) return null
  if (key === "ArrowDown" && position.index !== position.count - 1) return null
  return position.column
}

function getCaretForAdjacentBullet(text: string, key: "ArrowUp" | "ArrowDown", column: number) {
  const lineStarts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") lineStarts.push(index + 1)
  }

  const lineIndex = key === "ArrowUp" ? lineStarts.length - 1 : 0
  const start = lineStarts[lineIndex]
  const nextStart = lineStarts[lineIndex + 1]
  const end = nextStart === undefined ? text.length : nextStart - 1
  return Math.min(start + column, end)
}

function getSlashCommandTrigger(text: string, caret: number): { start: number; query: string } | null {
  const beforeCaret = text.slice(0, caret)
  const match = /(^|\s)\/([^\s/]*)$/.exec(beforeCaret)
  if (!match) return null
  return {
    start: beforeCaret.length - match[2].length - 1,
    query: match[2],
  }
}

function slashCommandReplacementEnd(text: string, start: number): number {
  let cursor = start + 1
  while (cursor < text.length && !/\s/.test(text[cursor])) {
    cursor += 1
  }
  return cursor
}

function dateForSlashCommand(command: SlashCommand): string {
  const date = new Date()
  date.setDate(date.getDate() + command.offsetDays)
  return `${weekdayLabels[date.getDay()]}, ${monthLabels[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
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

  const rawLink = parseRawLinkTokenAt(text, start)
  if (rawLink) return rawLink

  return null
}

function parseRawLinkTokenAt(text: string, start: number): ParsedMarkdownToken | null {
  if (start > 0 && !isRawLinkBoundary(text[start - 1])) return null

  const rest = text.slice(start)
  const match = /^(https?:\/\/|mailto:|www\.)[^\s<>"']+/i.exec(rest)
  if (!match) return null

  let label = match[0]
  label = label.replace(/[.,!?;:]+$/g, "")
  while (hasUnmatchedClosingBracket(label)) {
    label = label.slice(0, -1)
  }
  if (!label || label === match[1]) return null

  return {
    kind: "link",
    label,
    href: label.startsWith("www.") ? `https://${label}` : label,
    start,
    end: start + label.length,
  }
}

function isRawLinkBoundary(character: string): boolean {
  return /\s/.test(character) || character === "(" || character === "[" || character === "{"
}

function hasUnmatchedClosingBracket(text: string): boolean {
  const last = text.at(-1)
  if (last !== ")" && last !== "]" && last !== "}") return false
  const open = last === ")" ? "(" : last === "]" ? "[" : "{"
  const closeCount = text.split(last).length - 1
  const openCount = text.split(open).length - 1
  return closeCount > openCount
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

function isMarkdownFilePath(text: string): boolean {
  return /\.md(?:#.*)?$/i.test(text.trim())
}

function markdownDocumentPathFromHref(href: string): string | null {
  const trimmed = href.trim()
  if (!isMarkdownFilePath(trimmed)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("#")) return null
  return trimmed
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

type DepthStyle = CSSProperties & Record<"--depth", number>

function getAssistantOutcome(value: unknown): AssistantOutcome | null {
  if (value === "succeeded" || value === "failed" || value === "incomplete") return value
  return null
}

function wrapTextareaSelection(input: HTMLTextAreaElement, marker: string) {
  const selectionStart = input.selectionStart
  const selectionEnd = input.selectionEnd
  const selectedText = input.value.slice(selectionStart, selectionEnd)
  const wrappedSelectionStart = selectionStart + marker.length
  const wrappedSelectionEnd = wrappedSelectionStart + selectedText.length

  return {
    text: [
      input.value.slice(0, selectionStart),
      marker,
      selectedText,
      marker,
      input.value.slice(selectionEnd),
    ].join(""),
    selectionStart: wrappedSelectionStart,
    selectionEnd: wrappedSelectionEnd,
  }
}

export const BulletRow = memo(function BulletRow({
  node,
  depth,
  focused,
  previousVisibleNodeId,
  nextVisibleNodeId,
  unreadState,
  unreadDescendantPath,
  hiddenRunningDescendantCount,
  hasGeneratedChildOutput,
  hoverTitle,
}: BulletRowProps) {
  if (bulletRowRenderCounts) {
    bulletRowRenderCounts.set(node.id, getBulletRowRenderCount(node.id) + 1)
  }

  const { dispatch, executeNode, listFilesystem, openDocument, clearPanelDocument } =
    useOutlineActions()
  const undoStateRef = useContext(BulletRowUndoStateContext)
  const nodeId = node.id
  const trackInteraction = (name: string, detail?: Record<string, unknown>) => {
    measureInteractionToPaint(name, {
      nodeId,
      depth,
      textLength: node.text.length,
      ...(detail ?? {}),
    })
  }
  const hasChildren = node.children.length > 0
  const generated = node.metadata.generated === true
  const hasUnreadOutput = unreadState !== "none"
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
    (assistantOutcome === "succeeded" || hasGeneratedChildOutput)
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
  const [slashCommandMenu, setSlashCommandMenu] = useState<SlashCommandMenuState | null>(null)
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

  const filteredMentionEntries = useMemo(() => {
    if (!mentionPalette) return []
    const query = mentionPalette.query.toLowerCase()
    if (!query) return mentionPalette.entries
    return mentionPalette.entries
      .filter((entry) => entry.name.toLowerCase().includes(query))
      .sort((a, b) => rankMentionEntry(a, query) - rankMentionEntry(b, query))
  }, [mentionPalette])

  const filteredSlashCommands = useMemo(() => {
    if (!slashCommandMenu) return []
    const query = slashCommandMenu.query.toLowerCase()
    if (!query) return slashCommands
    return slashCommands.filter((command) => command.id.includes(query))
  }, [slashCommandMenu])

  useLayoutEffect(() => {
    measurePerf(
      "layout.textareaAutosize",
      { nodeId, textLength: node.text.length },
      () => {
        const textArea = textAreaRef.current
        if (!textArea) return
        textArea.style.height = "auto"
        textArea.style.height = `${textArea.scrollHeight}px`
      },
    )
  }, [node.text, nodeId])

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

  function openThreadPanel() {
    clearPanelDocument()
    if (node.threadId) {
      dispatch({ type: "select-thread", threadId: node.threadId, seenAt: Date.now() })
      dispatch({ type: "request-chat-focus" })
    }
    dispatch({ type: "open-panel" })
  }

  function openUnreadDescendant() {
    if (!unreadDescendantPath) return
    const unreadNodeId = unreadDescendantPath.at(-1)
    if (!unreadNodeId) return
    for (const ancestorId of unreadDescendantPath.slice(0, -1)) {
      dispatch({ type: "expand-node", nodeId: ancestorId })
    }
    dispatch({ type: "focus-node", nodeId: unreadNodeId })
    focusNodeInputAfterRender(unreadNodeId)
  }

  function handleRowMouseDown(event: MouseEvent<HTMLDivElement>) {
    resetVerticalNavigationColumn()
    if (event.target instanceof HTMLTextAreaElement) return
    if (event.target instanceof Element && event.target.closest("a, button")) return
    focusNode()
  }

  function updateMentionPaletteForInput(input: HTMLTextAreaElement, text: string) {
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

  function updateSlashCommandMenuForInput(input: HTMLTextAreaElement, text: string) {
    const trigger = getSlashCommandTrigger(text, input.selectionStart)
    if (!trigger) {
      setSlashCommandMenu(null)
      return
    }

    setSlashCommandMenu((current) => ({
      triggerStart: trigger.start,
      query: trigger.query,
      selectedIndex: current?.query === trigger.query ? current.selectedIndex : 0,
    }))
  }

  function insertMention(entry: FilesystemEntry, input: HTMLTextAreaElement) {
    if (!mentionPalette) return
    trackInteraction("insert-mention", { entryKind: entry.kind })
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
    setSlashCommandMenu(null)
    window.requestAnimationFrame(() => {
      const nextInput = findNodeInput(nodeId)
      nextInput?.focus()
      const caret = mentionPalette.triggerStart + token.length + 1
      nextInput?.setSelectionRange(caret, caret)
    })
  }

  function insertSlashCommandDate(command: SlashCommand, input: HTMLTextAreaElement) {
    if (!slashCommandMenu) return
    trackInteraction("insert-slash-command", { command: command.id })
    const currentText = input.value
    const dateText = dateForSlashCommand(command)
    const replacementEnd = slashCommandReplacementEnd(currentText, slashCommandMenu.triggerStart)
    const nextText = [
      currentText.slice(0, slashCommandMenu.triggerStart),
      dateText,
      currentText.slice(replacementEnd),
    ].join("")
    const caret = slashCommandMenu.triggerStart + dateText.length

    dispatch({ type: "update-text", nodeId, text: nextText })
    setSlashCommandMenu(null)
    setMentionPalette(null)
    window.requestAnimationFrame(() => {
      const nextInput = findNodeInput(nodeId)
      nextInput?.focus()
      nextInput?.setSelectionRange(caret, caret)
    })
  }

  function enterMentionFolder(entry: FilesystemEntry, input: HTMLTextAreaElement) {
    if (!mentionPalette || entry.kind !== "folder") return
    trackInteraction("enter-mention-folder")
    const token = `${mentionPathTokenFor(entry)}/`
    const currentText = input.value
    const replacementEnd = mentionReplacementEnd(currentText, mentionPalette.triggerStart)
    const nextText = `${currentText.slice(0, mentionPalette.triggerStart)}${token}${currentText.slice(replacementEnd)}`
    dispatch({ type: "update-text", nodeId, text: nextText })
    setSlashCommandMenu(null)
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

  function applyMarkdownWrapShortcut(input: HTMLTextAreaElement, marker: string) {
    const next = wrapTextareaSelection(input, marker)
    dispatch({ type: "update-text", nodeId, text: next.text })
    setMentionPalette(null)
    setSlashCommandMenu(null)
    window.requestAnimationFrame(() => {
      const nextInput = findNodeInput(nodeId)
      nextInput?.focus()
      nextInput?.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const hasSelectionModifier = event.shiftKey || event.ctrlKey
    const isPlainVerticalNavigation =
      !event.metaKey &&
      !event.altKey &&
      !hasSelectionModifier &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")

    if (!isPlainVerticalNavigation) {
      resetVerticalNavigationColumn()
    }

    if (slashCommandMenu) {
      resetVerticalNavigationColumn()
      if (event.key === "Escape") {
        event.preventDefault()
        setSlashCommandMenu(null)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        trackInteraction("slash-menu-selection", { direction: event.key === "ArrowDown" ? "down" : "up" })
        setSlashCommandMenu((current) => {
          if (!current) return current
          const count = filteredSlashCommands.length
          if (count === 0) return current
          const delta = event.key === "ArrowDown" ? 1 : -1
          return { ...current, selectedIndex: (current.selectedIndex + delta + count) % count }
        })
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const selected = filteredSlashCommands[slashCommandMenu.selectedIndex]
        if (selected) {
          insertSlashCommandDate(selected, event.currentTarget)
        }
        return
      }
    }

    if (mentionPalette) {
      resetVerticalNavigationColumn()
      if (event.key === "Escape") {
        event.preventDefault()
        setMentionPalette(null)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        trackInteraction("mention-menu-selection", { direction: event.key === "ArrowDown" ? "down" : "up" })
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

    if (event.metaKey && !event.altKey && !hasSelectionModifier) {
      const key = event.key.toLowerCase()
      const marker = key === "b" ? "**" : key === "i" ? "*" : null
      if (marker) {
        event.preventDefault()
        resetVerticalNavigationColumn()
        trackInteraction(`markdown-${key}`)
        applyMarkdownWrapShortcut(event.currentTarget, marker)
        return
      }
    }

    if (
      event.metaKey &&
      !event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      event.key.toLowerCase() === "z" &&
      undoStateRef?.current.hasRedo
    ) {
      const restoredNodeId = undoStateRef.current.nextRedoFocusedNodeId
      event.preventDefault()
      trackInteraction("redo", { restoredNodeId })
      dispatch({ type: "redo" })
      if (restoredNodeId) {
        focusNodeInputAfterRender(restoredNodeId)
      }
      return
    }

    if (
      event.metaKey &&
      !event.altKey &&
      !hasSelectionModifier &&
      event.key.toLowerCase() === "z" &&
      undoStateRef?.current.hasUndo
    ) {
      const restoredNodeId = undoStateRef.current.nextUndoFocusedNodeId
      event.preventDefault()
      trackInteraction("undo", { restoredNodeId })
      dispatch({ type: "undo" })
      if (restoredNodeId) {
        focusNodeInputAfterRender(restoredNodeId)
      }
      return
    }
    if (event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "Enter") {
      event.preventDefault()
      setMentionPalette(null)
      setSlashCommandMenu(null)
      if (node.threadId) {
        trackInteraction("open-thread-panel")
        openThreadPanel()
        return
      }
      trackInteraction("execute-node")
      executeNode(nodeId)
      return
    }
    if (event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "ArrowDown") {
      event.preventDefault()
      trackInteraction("expand-node")
      dispatch({ type: "expand-node", nodeId })
      return
    }
    if (event.metaKey && !event.altKey && !hasSelectionModifier && event.key === "ArrowUp") {
      event.preventDefault()
      trackInteraction("collapse-node")
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
      trackInteraction("move-node-same-depth", { direction: event.key === "ArrowUp" ? "up" : "down" })
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
      trackInteraction(event.shiftKey ? "outdent-node" : "indent-node")
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
      trackInteraction("move-node", { direction: event.key === "ArrowUp" ? "up" : "down" })
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
        trackInteraction("insert-first-child", { newNodeId, childCount: node.children.length })
        dispatch({
          type: "insert-first-child",
          parentId: nodeId,
          id: newNodeId,
          text: "",
        })
      } else {
        trackInteraction("insert-sibling-after", { newNodeId })
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
      trackInteraction("delete-task-checkbox")
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
          ? (previousVisibleNodeId ?? nextVisibleNodeId)
          : (nextVisibleNodeId ?? previousVisibleNodeId)

      event.preventDefault()
      trackInteraction("delete-node", { focusTarget })
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
      const boundaryColumn = getBoundaryLineColumn(event.currentTarget, event.key)
      if (boundaryColumn === null) {
        resetVerticalNavigationColumn()
        return
      }

      const adjacent = event.key === "ArrowUp" ? previousVisibleNodeId : nextVisibleNodeId
      const column = verticalNavigationColumn ?? boundaryColumn
      const targetInput = adjacent ? findNodeInput(adjacent) : null
      const targetCaret = targetInput
        ? getCaretForAdjacentBullet(targetInput.value, event.key, column)
        : undefined

      event.preventDefault()
      verticalNavigationColumn = column
      if (adjacent) {
        trackInteraction("focus-adjacent", {
          direction: event.key === "ArrowUp" ? "previous" : "next",
          targetNodeId: adjacent,
          column,
        })
        dispatch({ type: "focus-node", nodeId: adjacent })
        focusNodeInputAfterRender(adjacent, targetCaret)
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
          onClick={() => {
            trackInteraction(node.collapsed ? "expand-node-click" : "collapse-node-click")
            dispatch({ type: node.collapsed ? "expand-node" : "collapse-node", nodeId })
          }}
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
                trackInteraction("set-task-checked", { checked: event.currentTarget.checked })
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
          onMouseDown={resetVerticalNavigationColumn}
          onChange={(event) => {
            resetVerticalNavigationColumn()
            const nextText = event.currentTarget.value
            trackInteraction("update-text", { nextTextLength: nextText.length })
            dispatch({ type: "update-text", nodeId, text: nextText })
            updateMentionPaletteForInput(event.currentTarget, nextText)
            updateSlashCommandMenuForInput(event.currentTarget, nextText)
          }}
          onKeyDown={handleKeyDown}
        />
        {showRichDisplay ? (
          <div
            className="bullet-display"
            onMouseDown={(event) => {
              if (event.target instanceof Element && event.target.closest("a, button")) return
              focusNode()
              focusNodeInputAfterRender(nodeId)
            }}
          >
            {displayParts.map((part, index) => {
              if (part.kind === "mention") {
                if (isMarkdownFilePath(part.mention.path)) {
                  return (
                    <button
                      key={`${part.mention.id}-${index}`}
                      type="button"
                      className="mention-chip mention-chip-button"
                      title={part.mention.path}
                      aria-label={`Open ${mentionDisplayLabel(part.mention)}`}
                      onClick={() => openDocument(part.mention.path)}
                    >
                      {mentionDisplayLabel(part.mention)}
                    </button>
                  )
                }
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
                const documentPath = markdownDocumentPathFromHref(part.href)
                if (documentPath) {
                  return (
                    <button
                      key={`link-${index}`}
                      type="button"
                      className="markdown-link markdown-file-link-button"
                      aria-label={`Open ${part.label}`}
                      onClick={() => openDocument(documentPath)}
                    >
                      {part.label}
                    </button>
                  )
                }
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
                if (isMarkdownFilePath(part.path)) {
                  return (
                    <button
                      key={`mention-link-${index}`}
                      type="button"
                      className="mention-chip mention-chip-button"
                      title={part.path}
                      aria-label={`Open ${part.label}`}
                      onClick={() => openDocument(part.path)}
                    >
                      {part.label}
                    </button>
                  )
                }
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
                if (isMarkdownFilePath(part.text)) {
                  return (
                    <button
                      key={`code-${index}`}
                      type="button"
                      className="markdown-code markdown-file-button"
                      aria-label={`Open ${part.text}`}
                      onClick={() => openDocument(part.text)}
                    >
                      {part.text}
                    </button>
                  )
                }
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
      {slashCommandMenu ? (
        <SlashCommandMenu
          commands={filteredSlashCommands}
          selectedIndex={slashCommandMenu.selectedIndex}
        />
      ) : null}
      <div className="row-controls">
        {unreadDescendantPath ? (
          <button
            className="unread-dot"
            type="button"
            aria-label="Unread output"
            tabIndex={focused ? 0 : -1}
            onFocus={focusNode}
            onClick={openUnreadDescendant}
          />
        ) : hasUnreadOutput ? (
          <span className="unread-dot" role="img" aria-label="Unread output" />
        ) : null}
        {node.runStatus === "running" ? (
          <RunningSpinner label="Running" count={1} />
        ) : hiddenRunningDescendantCount > 0 ? (
          <RunningSpinner label="Child running" count={hiddenRunningDescendantCount} />
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
}, areBulletRowPropsEqual)

function areBulletRowPropsEqual(previous: BulletRowProps, next: BulletRowProps): boolean {
  return (
    previous.node === next.node &&
    previous.depth === next.depth &&
    previous.focused === next.focused &&
    previous.previousVisibleNodeId === next.previousVisibleNodeId &&
    previous.nextVisibleNodeId === next.nextVisibleNodeId &&
    previous.unreadState === next.unreadState &&
    previous.hiddenRunningDescendantCount === next.hiddenRunningDescendantCount &&
    previous.hasGeneratedChildOutput === next.hasGeneratedChildOutput &&
    previous.hoverTitle === next.hoverTitle &&
    pathsEqual(previous.unreadDescendantPath, next.unreadDescendantPath)
  )
}

function pathsEqual(left: BulletId[] | null, right: BulletId[] | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

function RunningSpinner({ label, count }: { label: string; count: number }) {
  return (
    <span className="running-spinner" aria-label={label}>
      <Loader2 className="spin" size={16} aria-hidden="true" />
      {count > 1 ? (
        <span className="running-spinner-count" aria-label={`${count} active spinners`}>
          {count}
        </span>
      ) : null}
    </span>
  )
}

function BulletTimestampTooltip({ id, title }: { id: string; title: string }) {
  return (
    <div
      id={id}
      className="floating-menu bullet-timestamp-tooltip"
      role="tooltip"
    >
      {title.split("\n").map((line) => {
        const separatorIndex = line.indexOf(": ")
        const label = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
        const detail = separatorIndex === -1 ? "" : line.slice(separatorIndex + 2)

        return (
          <div key={label} className="floating-menu-option bullet-timestamp-tooltip-row">
            <span className="floating-menu-option-label">{label}</span>
            <span className="floating-menu-option-detail">{detail}</span>
          </div>
        )
      })}
    </div>
  )
}

function SlashCommandMenu({
  commands,
  selectedIndex,
}: {
  commands: SlashCommand[]
  selectedIndex: number
}) {
  return (
    <div className="floating-menu slash-command-menu" role="listbox" aria-label="Slash commands">
      {commands.length === 0 ? (
        <div className="floating-menu-option slash-command-empty">No commands</div>
      ) : null}
      {commands.map((command, index) => (
        <div
          key={command.id}
          className={`floating-menu-option ${index === selectedIndex ? "is-selected" : ""}`}
          role="option"
          aria-selected={index === selectedIndex}
        >
          <span className="floating-menu-option-label">{command.label}</span>
          <span className="floating-menu-option-detail">{command.detail}</span>
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
