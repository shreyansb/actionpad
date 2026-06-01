import { useCallback, useEffect, useRef, useState } from "react"
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react"
import { FileText, Play, Square, X } from "lucide-react"
import { useOutlineStore } from "../store/useOutlineStore"
import { ChatInput } from "./ChatInput"
import { ChatThreadView } from "./ChatThreadView"

const DEFAULT_PANEL_WIDTH = 420
const MIN_PANEL_WIDTH = 340
const MAX_PANEL_WIDTH = 760

function findNodeInput(nodeId: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[data-node-input="${CSS.escape(nodeId)}"]`)
}

function filenameFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean)
  return segments.at(-1) ?? path
}

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width))
}

function isSafeMarkdownHref(href: string): boolean {
  return /^(https?:|mailto:|#|\/)/i.test(href)
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const codeMatch = /`([^`]+)`/.exec(text.slice(cursor))
    const strongMatch = /\*\*([^*]+)\*\*/.exec(text.slice(cursor))
    const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(text.slice(cursor))
    const matches = [
      codeMatch ? { kind: "code" as const, match: codeMatch } : null,
      strongMatch ? { kind: "strong" as const, match: strongMatch } : null,
      linkMatch ? { kind: "link" as const, match: linkMatch } : null,
    ].filter((match) => match !== null)

    const next = matches.sort((left, right) => left.match.index - right.match.index)[0]
    if (!next) {
      parts.push(text.slice(cursor))
      break
    }

    if (next.match.index > 0) {
      parts.push(text.slice(cursor, cursor + next.match.index))
    }

    const key = `${next.kind}-${cursor}-${next.match.index}`
    if (next.kind === "code") {
      parts.push(
        <code key={key} className="markdown-code">
          {next.match[1]}
        </code>,
      )
    } else if (next.kind === "strong") {
      parts.push(
        <strong key={key} className="markdown-strong">
          {next.match[1]}
        </strong>,
      )
    } else {
      const href = next.match[2].trim()
      parts.push(
        <a key={key} className="markdown-link" href={isSafeMarkdownHref(href) ? href : undefined}>
          {next.match[1]}
        </a>,
      )
    }

    cursor += next.match.index + next.match[0].length
  }

  return parts
}

function MarkdownDocument({ content }: { content: string }) {
  const blocks: ReactNode[] = []
  const lines = content.split("\n")
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <pre key={`code-${index}`} className="document-viewer-code">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements
      blocks.push(
        <HeadingTag key={`heading-${index}`} className="document-viewer-heading">
          {renderInlineMarkdown(heading[2])}
        </HeadingTag>,
      )
      index += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const itemText = lines[index].replace(/^\s*[-*]\s+/, "")
        items.push(<li key={`item-${index}`}>{renderInlineMarkdown(itemText)}</li>)
        index += 1
      }
      blocks.push(
        <ul key={`list-${index}`} className="document-viewer-list">
          {items}
        </ul>,
      )
      continue
    }

    const paragraphLines = [line.trim()]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !lines[index].startsWith("```")
    ) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="document-viewer-paragraph">
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>,
    )
  }

  return <div className="document-viewer-content">{blocks}</div>
}

export function SidePanel() {
  const {
    state,
    panelDocument,
    dispatch,
    executeNode,
    sendChatMessage,
    cancelRun,
    loadPanelDocument,
    setPanelDocumentLoaded,
    setPanelDocumentError,
    clearPanelDocument,
  } = useOutlineStore()
  const focusedNode = state.focusedNodeId ? state.nodes[state.focusedNodeId] : null
  const selectedThread = state.selectedThreadId ? state.threads[state.selectedThreadId] : null
  const focusedThread = focusedNode?.threadId ? state.threads[focusedNode.threadId] : null
  const thread = state.panelOpen && focusedNode ? focusedThread : selectedThread
  const node = focusedNode ?? (thread ? state.nodes[thread.nodeId] : null)
  const activeRunId = node?.runStatus === "running" ? node.activeRunId : undefined
  const displayedRunId = activeRunId ?? thread?.runs.at(-1) ?? null
  const chatAutoFocusKey =
    thread && state.selectedThreadId === thread.id ? `${thread.id}:${state.chatFocusRequest}` : null
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const sidePanelStyle = { width: `${panelWidth}px` }

  const startResizeAt = useCallback(
    (clientX: number) => {
      dragStartRef.current = { startX: clientX, startWidth: panelWidth }

      const resizePanel = (moveEvent: globalThis.PointerEvent) => {
        const dragStart = dragStartRef.current
        if (!dragStart) return
        setPanelWidth(clampPanelWidth(dragStart.startWidth + dragStart.startX - moveEvent.clientX))
      }

      const stopResize = () => {
        dragStartRef.current = null
        window.removeEventListener("pointermove", resizePanel)
        window.removeEventListener("pointerup", stopResize)
      }

      window.addEventListener("pointermove", resizePanel)
      window.addEventListener("pointerup", stopResize)
    },
    [panelWidth],
  )

  const startPointerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      startResizeAt(event.clientX)
    },
    [startResizeAt],
  )

  const startMouseResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (typeof globalThis.PointerEvent !== "undefined") return
      event.preventDefault()
      dragStartRef.current = { startX: event.clientX, startWidth: panelWidth }

      const resizePanel = (moveEvent: globalThis.MouseEvent) => {
        const dragStart = dragStartRef.current
        if (!dragStart) return
        setPanelWidth(clampPanelWidth(dragStart.startWidth + dragStart.startX - moveEvent.clientX))
      }

      const stopResize = () => {
        dragStartRef.current = null
        window.removeEventListener("mousemove", resizePanel)
        window.removeEventListener("mouseup", stopResize)
      }

      window.addEventListener("mousemove", resizePanel)
      window.addEventListener("mouseup", stopResize)
    },
    [panelWidth],
  )

  const resizeWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setPanelWidth((current) => clampPanelWidth(current + (event.key === "ArrowLeft" ? 24 : -24)))
  }, [])

  const resizeHandle = (
    <div
      role="separator"
      aria-label="Resize side panel"
      aria-orientation="vertical"
      tabIndex={0}
      className="side-panel-resize-handle"
      onPointerDown={startPointerResize}
      onMouseDown={startMouseResize}
      onKeyDown={resizeWithKeyboard}
    />
  )

  const closePanelAndRestoreFocus = useCallback(() => {
    const nodeId = state.focusedNodeId
    clearPanelDocument()
    dispatch({ type: "close-panel" })
    if (nodeId) {
      window.requestAnimationFrame(() => {
        findNodeInput(nodeId)?.focus()
      })
    }
  }, [clearPanelDocument, dispatch, state.focusedNodeId])

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
    if (!panelDocument || !panelDocument.loading) return
    let cancelled = false

    loadPanelDocument(panelDocument.path)
      .then((file) => {
        if (!cancelled) setPanelDocumentLoaded(panelDocument.path, file.content)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not read markdown file."
        if (!cancelled) setPanelDocumentError(panelDocument.path, message)
      })

    return () => {
      cancelled = true
    }
  }, [
    loadPanelDocument,
    panelDocument,
    setPanelDocumentError,
    setPanelDocumentLoaded,
  ])

  if (!state.panelOpen) return null

  if (panelDocument) {
    return (
      <aside className="side-panel" aria-label="Markdown file panel" style={sidePanelStyle}>
        {resizeHandle}
        <header className="side-panel-header">
          <div>
            <span className="panel-eyebrow">Markdown File</span>
            <h2>{filenameFromPath(panelDocument.path)}</h2>
            <div className="side-panel-meta">
              <span>{panelDocument.path}</span>
            </div>
          </div>
          <div className="side-panel-header-actions">
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
        <div className="document-viewer">
          {panelDocument.loading ? (
            <div className="panel-empty">
              <FileText size={16} />
              <p>Loading file...</p>
            </div>
          ) : panelDocument.error ? (
            <div className="panel-empty">
              <p>{panelDocument.error}</p>
            </div>
          ) : (
            <MarkdownDocument content={panelDocument.content ?? ""} />
          )}
        </div>
      </aside>
    )
  }

  return (
    <aside className="side-panel" aria-label="Bullet chat panel" style={sidePanelStyle}>
      {resizeHandle}
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
