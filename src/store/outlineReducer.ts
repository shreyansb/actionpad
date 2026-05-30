import type { BulletDraft, BulletId, OutlineState, OutlineUndoSnapshot, ThreadId } from "../domain/types"
import type { AgentRuntimeEvent, RunId } from "../domain/runtimeProtocol"
import {
  appendChildBullets,
  collapseNode,
  deleteNode,
  expandNode,
  indentNode,
  insertSiblingAfter,
  moveNode,
  outdentNode,
  reparentNode,
  updateNodeText,
} from "../domain/treeOps"

type DraftWithId = BulletDraft & { id: BulletId }
const UNDO_LIMIT = 100

export type OutlineAction =
  | { type: "focus-node"; nodeId: BulletId }
  | { type: "update-text"; nodeId: BulletId; text: string }
  | { type: "insert-sibling-after"; afterNodeId: BulletId; id: BulletId; text: string }
  | { type: "delete-node"; nodeId: BulletId; focusNodeId: BulletId | null }
  | { type: "undo" }
  | { type: "indent-node"; nodeId: BulletId }
  | { type: "outdent-node"; nodeId: BulletId }
  | { type: "move-node"; nodeId: BulletId; direction: "up" | "down" }
  | { type: "reparent-node"; nodeId: BulletId; targetParentId: BulletId | null }
  | { type: "collapse-node"; nodeId: BulletId }
  | { type: "expand-node"; nodeId: BulletId }
  | { type: "open-panel" }
  | { type: "close-panel" }
  | { type: "request-chat-focus" }
  | { type: "select-thread"; threadId: ThreadId | null }
  | {
      type: "runtime-event"
      event: AgentRuntimeEvent
      createdAt: number
      context?: string
      generatedIds?: BulletId[]
    }
  | {
      type: "run-started"
      nodeId: BulletId
      threadId: ThreadId
      context: string
      createdAt: number
    }
  | {
      type: "run-completed"
      nodeId: BulletId
      threadId: ThreadId
      assistantMessage: string
      bullets: DraftWithId[]
      createdAt: number
    }

function cloneNode(node: OutlineState["nodes"][string]): OutlineState["nodes"][string] {
  return { ...node, children: [...node.children], metadata: { ...node.metadata } }
}

function cloneThread(thread: OutlineState["threads"][string]): OutlineState["threads"][string] {
  return {
    ...thread,
    messages: [...thread.messages],
    events: [...thread.events],
    runs: [...thread.runs],
  }
}

function createUndoSnapshot(state: OutlineState): OutlineUndoSnapshot {
  return {
    rootIds: [...state.rootIds],
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, node]) => [id, cloneNode(node)]),
    ),
    focusedNodeId: state.focusedNodeId,
    selectedThreadId: state.selectedThreadId,
    chatFocusRequest: state.chatFocusRequest,
    panelOpen: state.panelOpen,
    threads: Object.fromEntries(
      Object.entries(state.threads).map(([threadId, thread]) => [threadId, cloneThread(thread)]),
    ),
    runs: Object.fromEntries(
      Object.entries(state.runs).map(([runId, run]) => [
        runId,
        { ...run, providerMetadata: { ...run.providerMetadata } },
      ]),
    ),
  }
}

function restoreUndoSnapshot(
  snapshot: OutlineUndoSnapshot,
  undoStack: OutlineUndoSnapshot[],
): OutlineState {
  return {
    ...createUndoSnapshot({ ...snapshot, undoStack: [] }),
    undoStack,
  }
}

function withUndo(state: OutlineState, next: OutlineState): OutlineState {
  if (next === state) return state
  return {
    ...next,
    undoStack: [...state.undoStack.slice(-(UNDO_LIMIT - 1)), createUndoSnapshot(state)],
  }
}

function getRunContext(state: OutlineState, runId: RunId) {
  const run = state.runs[runId]
  if (!run) return null
  const thread = state.threads[run.threadId]
  const node = state.nodes[run.nodeId]
  if (!thread || !node) return null
  return { run, thread, node }
}

function hasMessage(state: OutlineState, threadId: ThreadId, messageId: string): boolean {
  return state.threads[threadId]?.messages.some((message) => message.id === messageId) ?? false
}

function isActiveRunContext(context: NonNullable<ReturnType<typeof getRunContext>>, runId: RunId) {
  return context.run.status === "running" && context.node.activeRunId === runId
}

export function outlineReducer(state: OutlineState, action: OutlineAction): OutlineState {
  switch (action.type) {
    case "focus-node":
      return { ...state, focusedNodeId: action.nodeId }
    case "update-text":
      return withUndo(state, updateNodeText(state, action.nodeId, action.text))
    case "insert-sibling-after":
      return withUndo(
        state,
        insertSiblingAfter(state, action.afterNodeId, { id: action.id, text: action.text }),
      )
    case "delete-node":
      return withUndo(state, deleteNode(state, action.nodeId, action.focusNodeId))
    case "undo": {
      const snapshot = state.undoStack[state.undoStack.length - 1]
      if (!snapshot) return state
      return restoreUndoSnapshot(snapshot, state.undoStack.slice(0, -1))
    }
    case "indent-node":
      return withUndo(state, indentNode(state, action.nodeId))
    case "outdent-node":
      return withUndo(state, outdentNode(state, action.nodeId))
    case "move-node":
      return withUndo(state, moveNode(state, action.nodeId, action.direction))
    case "reparent-node":
      return withUndo(state, reparentNode(state, action.nodeId, action.targetParentId))
    case "collapse-node":
      return withUndo(state, collapseNode(state, action.nodeId))
    case "expand-node":
      return withUndo(state, expandNode(state, action.nodeId))
    case "open-panel":
      return { ...state, panelOpen: true }
    case "close-panel":
      return { ...state, panelOpen: false }
    case "request-chat-focus":
      return { ...state, chatFocusRequest: state.chatFocusRequest + 1 }
    case "select-thread":
      return {
        ...state,
        selectedThreadId: action.threadId,
        panelOpen: action.threadId ? true : state.panelOpen,
      }
    case "runtime-event": {
      switch (action.event.type) {
        case "run-started": {
          const node = state.nodes[action.event.nodeId]
          if (!node) return state
          const existingThread = state.threads[action.event.threadId]
          if (existingThread && existingThread.nodeId !== action.event.nodeId) return state
          const isAttachedExistingRun =
            existingThread?.nodeId === action.event.nodeId &&
            node.threadId === action.event.threadId &&
            node.activeRunId === action.event.runId &&
            state.runs[action.event.runId]?.status === "running"

          if (node.threadId || node.runStatus === "running") {
            if (!isAttachedExistingRun) return state
            return {
              ...state,
              focusedNodeId: action.event.nodeId,
              selectedThreadId: action.event.threadId,
              panelOpen: true,
            }
          }

          const context = action.context ?? ""
          const provider = action.event.provider ?? "codex"
          const providerThreadId = action.event.providerThreadId ?? null
          const thread = existingThread ?? {
            id: action.event.threadId,
            provider,
            providerThreadId,
            nodeId: action.event.nodeId,
            messages: [],
            events: [],
            runs: [],
          }
          const hasRun = thread.runs.includes(action.event.runId)

          return withUndo(state, {
            ...state,
            focusedNodeId: action.event.nodeId,
            selectedThreadId: action.event.threadId,
            panelOpen: true,
            nodes: {
              ...state.nodes,
              [action.event.nodeId]: {
                ...node,
                runStatus: "running",
                threadId: action.event.threadId,
                activeRunId: action.event.runId,
              },
            },
            threads: {
              ...state.threads,
              [action.event.threadId]: {
                ...thread,
                provider,
                providerThreadId,
                messages: [
                  ...thread.messages,
                  {
                    id: `${action.event.threadId}-user-${action.createdAt}`,
                    role: "user",
                    content: context,
                    createdAt: action.createdAt,
                    status: "complete",
                  },
                ],
                events: [
                  ...thread.events,
                  {
                    type: "run-started",
                    nodeId: action.event.nodeId,
                    runId: action.event.runId,
                    createdAt: action.createdAt,
                  },
                ],
                runs: hasRun ? thread.runs : [...thread.runs, action.event.runId],
              },
            },
            runs: {
              ...state.runs,
              [action.event.runId]: {
                id: action.event.runId,
                threadId: action.event.threadId,
                nodeId: action.event.nodeId,
                provider,
                status: "running",
                prompt: node.text,
                context,
                createdAt: action.createdAt,
                updatedAt: action.createdAt,
                providerMetadata: {},
              },
            },
          })
        }
        case "assistant-message-started": {
          const event = action.event
          const context = getRunContext(state, action.event.runId)
          if (!context) return state
          if (hasMessage(state, context.thread.id, event.messageId)) return state
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                messages: [
                  ...context.thread.messages,
                  {
                    id: event.messageId,
                    role: "assistant",
                    content: "",
                    createdAt: action.createdAt,
                    status: "streaming",
                  },
                ],
              },
            },
          }
        }
        case "assistant-delta": {
          const event = action.event
          const context = getRunContext(state, event.runId)
          if (!context) return state
          const messageIndex = context.thread.messages.findIndex(
            (message) => message.id === event.messageId,
          )
          if (messageIndex === -1) return state
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                messages: context.thread.messages.map((message, index) =>
                  index === messageIndex
                    ? {
                        ...message,
                        content: `${message.content}${event.delta}`,
                        status: "streaming",
                      }
                    : message,
                ),
              },
            },
          }
        }
        case "assistant-message-completed": {
          const event = action.event
          const context = getRunContext(state, event.runId)
          if (!context) return state
          const messageIndex = context.thread.messages.findIndex(
            (message) => message.id === event.messageId,
          )
          if (messageIndex === -1) return state
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                messages: context.thread.messages.map((message, index) =>
                  index === messageIndex
                    ? {
                        ...message,
                        content: event.content ?? event.text ?? message.content,
                        status: "complete",
                      }
                    : message,
                ),
              },
            },
          }
        }
        case "message-created": {
          const context = getRunContext(state, action.event.runId)
          if (!context) return state
          const createdAt = action.event.message.createdAt ?? action.createdAt
          const messageId =
            action.event.message.id ??
            `${action.event.runId}-message-${action.event.createdAt}-${action.event.message.role}`
          if (hasMessage(state, context.thread.id, messageId)) return state

          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                messages: [
                  ...context.thread.messages,
                  {
                    id: messageId,
                    role: action.event.message.role,
                    content: action.event.message.content,
                    createdAt,
                    status: action.event.message.status ?? "complete",
                  },
                ],
                events: [
                  ...context.thread.events,
                  {
                    type: "message-created",
                    messageId,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
          }
        }
        case "outline-patch": {
          const context = getRunContext(state, action.event.runId)
          if (!context) return state
          if (!isActiveRunContext(context, action.event.runId)) return state
          if (action.event.patch.type !== "append-child-bullets") return state
          if ((action.generatedIds?.length ?? 0) !== action.event.patch.bullets.length) return state

          const bullets = action.event.patch.bullets.map((bullet, index) => ({
            id: action.generatedIds?.[index] ?? "",
            text: bullet.text,
            metadata: bullet.metadata,
          }))
          const withChildren = appendChildBullets(
            state,
            action.event.patch.parentId,
            bullets,
          )
          if (withChildren === state) return state

          const thread = withChildren.threads[context.thread.id]
          return withUndo(state, {
            ...withChildren,
            threads: {
              ...withChildren.threads,
              [context.thread.id]: {
                ...thread,
                events: [
                  ...thread.events,
                  {
                    type: "outline-output",
                    output: action.event.patch,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
          })
        }
        case "run-completed": {
          const context = getRunContext(state, action.event.runId)
          if (!context) return state
          if (!isActiveRunContext(context, action.event.runId)) return state
          return {
            ...state,
            nodes: {
              ...state.nodes,
              [context.node.id]: {
                ...context.node,
                runStatus: "succeeded",
                activeRunId: undefined,
              },
            },
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                events: [
                  ...context.thread.events,
                  {
                    type: "run-completed",
                    nodeId: context.node.id,
                    runId: action.event.runId,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
            runs: {
              ...state.runs,
              [action.event.runId]: {
                ...context.run,
                status: "succeeded",
                updatedAt: action.createdAt,
              },
            },
          }
        }
        case "run-failed": {
          const context = getRunContext(state, action.event.runId)
          if (!context) return state
          if (!isActiveRunContext(context, action.event.runId)) return state
          return {
            ...state,
            nodes: {
              ...state.nodes,
              [context.node.id]: {
                ...context.node,
                runStatus: "failed",
                activeRunId: undefined,
              },
            },
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                events: [
                  ...context.thread.events,
                  {
                    type: "run-failed",
                    nodeId: context.node.id,
                    runId: action.event.runId,
                    error: action.event.error,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
            runs: {
              ...state.runs,
              [action.event.runId]: {
                ...context.run,
                status: "failed",
                error: action.event.error,
                updatedAt: action.createdAt,
              },
            },
          }
        }
        case "tool-started": {
          const event = action.event
          const context = getRunContext(state, event.runId)
          if (!context) return state
          if (
            context.thread.events.some(
              (threadEvent) =>
                threadEvent.type === "tool-started" &&
                threadEvent.runId === event.runId &&
                threadEvent.toolCallId === event.toolCallId,
            )
          ) {
            return state
          }
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                events: [
                  ...context.thread.events,
                  {
                    type: "tool-started",
                    toolCallId: event.toolCallId,
                    name: event.name,
                    runId: event.runId,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
          }
        }
        case "tool-completed": {
          const event = action.event
          const context = getRunContext(state, event.runId)
          if (!context) return state
          if (
            context.thread.events.some(
              (threadEvent) =>
                threadEvent.type === "tool-completed" &&
                threadEvent.runId === event.runId &&
                threadEvent.toolCallId === event.toolCallId,
            )
          ) {
            return state
          }
          let startedName: string | undefined
          for (const threadEvent of context.thread.events) {
            if (
              threadEvent.type === "tool-started" &&
              threadEvent.runId === event.runId &&
              threadEvent.toolCallId === event.toolCallId
            ) {
              startedName = threadEvent.name
              break
            }
          }
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                events: [
                  ...context.thread.events,
                  {
                    type: "tool-completed",
                    toolCallId: event.toolCallId,
                    name: event.name ?? startedName,
                    runId: event.runId,
                    output: event.output,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
          }
        }
        case "approval-requested": {
          const event = action.event
          const context = getRunContext(state, event.runId)
          if (!context) return state
          if (
            context.thread.events.some(
              (threadEvent) =>
                threadEvent.type === "approval-requested" &&
                threadEvent.runId === event.runId &&
                threadEvent.approvalId === event.approval.id,
            )
          ) {
            return state
          }
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                events: [
                  ...context.thread.events,
                  {
                    type: "approval-requested",
                    approvalId: event.approval.id,
                    runId: event.runId,
                    createdAt: action.createdAt,
                  },
                ],
              },
            },
          }
        }
        default:
          return state
      }
    }
    case "run-started": {
      const node = state.nodes[action.nodeId]
      if (!node) return state
      const existingThread = state.threads[action.threadId]
      const isAttachedExistingThread =
        existingThread?.nodeId === action.nodeId && node.threadId === action.threadId

      if (node.threadId || node.runStatus === "running") {
        if (!isAttachedExistingThread) return state
        return {
          ...state,
          focusedNodeId: action.nodeId,
          selectedThreadId: action.threadId,
          panelOpen: true,
        }
      }

      if (existingThread) {
        if (existingThread.nodeId !== action.nodeId) return state
        return {
          ...state,
          focusedNodeId: action.nodeId,
          selectedThreadId: action.threadId,
          panelOpen: true,
        }
      }
      return withUndo(state, {
        ...state,
        focusedNodeId: action.nodeId,
        selectedThreadId: action.threadId,
        panelOpen: true,
        nodes: {
          ...state.nodes,
          [action.nodeId]: {
            ...node,
            runStatus: "running",
            threadId: action.threadId,
          },
        },
        threads: {
          ...state.threads,
          [action.threadId]: {
            id: action.threadId,
            provider: "codex",
            providerThreadId: null,
            nodeId: action.nodeId,
            messages: [
              {
                id: `${action.threadId}-user`,
                role: "user",
                content: action.context,
                createdAt: action.createdAt,
                status: "complete",
              },
            ],
            events: [{ type: "run-started", nodeId: action.nodeId, createdAt: action.createdAt }],
            runs: [],
          },
        },
      })
    }
    case "run-completed": {
      const node = state.nodes[action.nodeId]
      const thread = state.threads[action.threadId]
      if (!node) return state
      if (!thread) return state
      if (thread.nodeId !== action.nodeId) return state
      if (node.threadId !== action.threadId) return state
      if (node.runStatus !== "running") return state
      if (action.bullets.length === 0) return state

      const withChildren = appendChildBullets(state, action.nodeId, action.bullets)
      if (withChildren === state) return state

      return withUndo(state, {
        ...withChildren,
        nodes: {
          ...withChildren.nodes,
          [action.nodeId]: {
            ...withChildren.nodes[action.nodeId],
            runStatus: "succeeded",
          },
        },
        threads: {
          ...withChildren.threads,
          [action.threadId]: {
            ...thread,
            messages: [
              ...thread.messages,
              {
                id: `${action.threadId}-assistant-${action.createdAt}`,
                role: "assistant",
                content: action.assistantMessage,
                createdAt: action.createdAt,
                status: "complete",
              },
            ],
            events: [
              ...thread.events,
              {
                type: "outline-output",
                output: {
                  type: "append-child-bullets",
                  parentId: action.nodeId,
                  bullets: action.bullets,
                },
                createdAt: action.createdAt,
              },
              { type: "run-completed", nodeId: action.nodeId, createdAt: action.createdAt },
            ],
          },
        },
      })
    }
    default:
      return state
  }
}
