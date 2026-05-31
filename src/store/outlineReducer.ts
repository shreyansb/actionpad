import type { BulletDraft, BulletId, OutlineState, OutlineUndoSnapshot, ThreadId } from "../domain/types"
import type { AgentRuntimeEvent, BulletMention, OutlinePatch, RunId } from "../domain/runtimeProtocol"
import {
  appendChildBullets,
  collapseNode,
  deleteNode,
  expandNode,
  insertFirstChild,
  indentNode,
  insertSiblingAfter,
  moveNode,
  moveNodeAtSameDepth,
  outdentNode,
  reparentNode,
  updateNodeText,
} from "../domain/treeOps"

type DraftWithId = BulletDraft & { id: BulletId; children?: DraftWithId[] }
const UNDO_LIMIT = 100

export type OutlineAction =
  | { type: "hydrate-state"; state: OutlineState }
  | { type: "focus-node"; nodeId: BulletId }
  | { type: "update-text"; nodeId: BulletId; text: string }
  | { type: "attach-mention"; nodeId: BulletId; mention: BulletMention }
  | { type: "insert-sibling-after"; afterNodeId: BulletId; id: BulletId; text: string }
  | { type: "insert-first-child"; parentId: BulletId; id: BulletId; text: string }
  | { type: "delete-node"; nodeId: BulletId; focusNodeId: BulletId | null }
  | { type: "undo" }
  | { type: "indent-node"; nodeId: BulletId }
  | { type: "outdent-node"; nodeId: BulletId }
  | { type: "move-node"; nodeId: BulletId; direction: "up" | "down" }
  | { type: "move-node-at-same-depth"; nodeId: BulletId; direction: "up" | "down" }
  | { type: "reparent-node"; nodeId: BulletId; targetParentId: BulletId | null }
  | { type: "collapse-node"; nodeId: BulletId }
  | { type: "expand-node"; nodeId: BulletId }
  | { type: "open-panel" }
  | { type: "close-panel" }
  | { type: "request-chat-focus" }
  | { type: "select-thread"; threadId: ThreadId | null; seenAt?: number }
  | {
      type: "runtime-event"
      event: AgentRuntimeEvent
      createdAt: number
      context?: string
      generatedIds?: BulletId[]
    }
  | {
      type: "run-failed-local"
      nodeId: BulletId
      threadId: ThreadId
      runId: RunId
      context: string
      error: string
      createdAt: number
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
  return {
    ...node,
    children: [...node.children],
    metadata: {
      ...node.metadata,
      mentions: node.metadata.mentions ? [...node.metadata.mentions] : undefined,
    },
  }
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

function attachMention(state: OutlineState, nodeId: BulletId, mention: BulletMention): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  const mentions = node.metadata.mentions ?? []
  if (mentions.some((existing) => existing.id === mention.id)) return state
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...node,
        metadata: {
          ...node.metadata,
          mentions: [...mentions, mention],
        },
      },
    },
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

function createPatchKey(event: Extract<AgentRuntimeEvent, { type: "outline-patch" }>): string {
  return `${event.runId}:${event.createdAt}:${JSON.stringify(event.patch)}`
}

function countDrafts(drafts: BulletDraft[]): number {
  return drafts.reduce((count, draft) => count + 1 + countDrafts(draft.children ?? []), 0)
}

function countPatchDrafts(patch: OutlinePatch): number {
  switch (patch.type) {
    case "append-child-bullets":
      return countDrafts(patch.bullets)
    case "batch":
      return patch.patches.reduce((count, childPatch) => count + countPatchDrafts(childPatch), 0)
    default:
      return 0
  }
}

function assignDraftIds(drafts: BulletDraft[], ids: BulletId[], cursor: { index: number }): DraftWithId[] {
  return drafts.map((draft) => {
    const id = ids[cursor.index]
    cursor.index += 1
    return {
      ...draft,
      id,
      children: draft.children ? assignDraftIds(draft.children, ids, cursor) : undefined,
    }
  })
}

function applyOutlinePatch(
  state: OutlineState,
  patch: OutlinePatch,
  generatedIds: BulletId[],
  cursor: { index: number },
): OutlineState {
  switch (patch.type) {
    case "append-child-bullets": {
      const draftCount = countDrafts(patch.bullets)
      const ids = generatedIds.slice(cursor.index, cursor.index + draftCount)
      if (ids.length !== draftCount || ids.some((id) => !id)) return state
      cursor.index += draftCount
      return appendChildBullets(
        state,
        patch.parentId,
        assignDraftIds(patch.bullets, ids, { index: 0 }),
      )
    }
    case "update-bullet-text":
      return updateNodeText(state, patch.nodeId, patch.text)
    case "delete-bullets":
      return patch.nodeIds.reduce(
        (next, nodeId) => deleteNode(next, nodeId, next.focusedNodeId),
        state,
      )
    case "batch":
      return patch.patches.reduce(
        (next, childPatch) => applyOutlinePatch(next, childPatch, generatedIds, cursor),
        state,
      )
    case "set-bullet-run-status":
      return state
  }
}

function syncTerminalRunIntoUndoStack(state: OutlineState, runId: RunId): OutlineUndoSnapshot[] {
  const run = state.runs[runId]
  if (!run) return state.undoStack
  const node = state.nodes[run.nodeId]
  const thread = state.threads[run.threadId]

  return state.undoStack.map((snapshot) => {
    const snapshotNode = snapshot.nodes[run.nodeId]
    const snapshotThread = snapshot.threads[run.threadId]
    const mentionsRun =
      Boolean(snapshot.runs[runId]) ||
      snapshotNode?.activeRunId === runId ||
      snapshotThread?.runs.includes(runId)

    if (!mentionsRun) return snapshot

    return {
      ...snapshot,
      nodes: snapshotNode
        ? {
            ...snapshot.nodes,
            [run.nodeId]: {
              ...snapshotNode,
              runStatus: node?.runStatus ?? snapshotNode.runStatus,
              threadId: node?.threadId ?? snapshotNode.threadId,
              activeRunId: node?.activeRunId,
            },
          }
        : snapshot.nodes,
      threads: thread
        ? {
            ...snapshot.threads,
            [run.threadId]: cloneThread(thread),
          }
        : snapshot.threads,
      runs: {
        ...snapshot.runs,
        [runId]: { ...run, providerMetadata: { ...run.providerMetadata } },
      },
    }
  })
}

function markThreadActivity(
  state: OutlineState,
  thread: OutlineState["threads"][string],
  createdAt: number,
): OutlineState["threads"][string] {
  const lastSeenAt =
    state.panelOpen && state.selectedThreadId === thread.id
      ? Math.max(thread.lastSeenAt ?? 0, createdAt)
      : thread.lastSeenAt

  return {
    ...thread,
    lastActivityAt: createdAt,
    ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
  }
}

function markThreadSeen(
  thread: OutlineState["threads"][string],
  seenAt: number,
): OutlineState["threads"][string] {
  return {
    ...thread,
    lastSeenAt: Math.max(thread.lastSeenAt ?? 0, seenAt),
  }
}

export function outlineReducer(state: OutlineState, action: OutlineAction): OutlineState {
  switch (action.type) {
    case "hydrate-state":
      return action.state
    case "focus-node":
      return { ...state, focusedNodeId: action.nodeId }
    case "update-text":
      return withUndo(state, updateNodeText(state, action.nodeId, action.text))
    case "attach-mention":
      return withUndo(state, attachMention(state, action.nodeId, action.mention))
    case "insert-sibling-after":
      return withUndo(
        state,
        insertSiblingAfter(state, action.afterNodeId, { id: action.id, text: action.text }),
      )
    case "insert-first-child":
      return withUndo(
        state,
        insertFirstChild(state, action.parentId, { id: action.id, text: action.text }),
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
    case "move-node-at-same-depth":
      return withUndo(state, moveNodeAtSameDepth(state, action.nodeId, action.direction))
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
    case "select-thread": {
      const selectedThread =
        action.threadId && action.seenAt ? state.threads[action.threadId] : undefined
      return {
        ...state,
        selectedThreadId: action.threadId,
        panelOpen: action.threadId ? true : state.panelOpen,
        threads: selectedThread
          ? {
              ...state.threads,
              [selectedThread.id]: markThreadSeen(selectedThread, action.seenAt!),
            }
          : state.threads,
      }
    }
    case "run-failed-local": {
      const node = state.nodes[action.nodeId]
      if (!node) return state
      const existingThread = state.threads[action.threadId]
      return {
        ...state,
        focusedNodeId: action.nodeId,
        selectedThreadId: action.threadId,
        panelOpen: state.panelOpen,
        nodes: {
          ...state.nodes,
          [action.nodeId]: {
            ...node,
            runStatus: "failed",
            threadId: action.threadId,
            activeRunId: undefined,
          },
        },
        threads: {
          ...state.threads,
          [action.threadId]: markThreadActivity(
            state,
            {
              ...existingThread,
              id: action.threadId,
              provider: "codex",
              providerThreadId: existingThread?.providerThreadId ?? null,
              nodeId: action.nodeId,
              messages: [
                ...(existingThread?.messages ?? []),
                {
                  id: `${action.runId}-user`,
                  role: "user",
                  content: action.context,
                  createdAt: action.createdAt,
                  status: "complete",
                },
              ],
              events: [
                ...(existingThread?.events ?? []),
                {
                  type: "run-started",
                  nodeId: action.nodeId,
                  runId: action.runId,
                  createdAt: action.createdAt,
                },
                {
                  type: "run-failed",
                  nodeId: action.nodeId,
                  runId: action.runId,
                  error: action.error,
                  createdAt: action.createdAt,
                },
              ],
              runs: existingThread?.runs.includes(action.runId)
                ? existingThread.runs
                : [...(existingThread?.runs ?? []), action.runId],
            },
            action.createdAt,
          ),
        },
        runs: {
          ...state.runs,
          [action.runId]: {
            id: action.runId,
            threadId: action.threadId,
            nodeId: action.nodeId,
            provider: "codex",
            status: "failed",
            prompt: node.text,
            context: action.context,
            createdAt: action.createdAt,
            updatedAt: action.createdAt,
            error: action.error,
            providerMetadata: {},
          },
        },
      }
    }
    case "runtime-event": {
      switch (action.event.type) {
        case "run-started": {
          const node = state.nodes[action.event.nodeId]
          if (!node) return state
          const existingThread = state.threads[action.event.threadId]
          if (existingThread && existingThread.nodeId !== action.event.nodeId) return state
          if (node.runStatus === "running") {
            return state
          }
          if (node.threadId && node.threadId !== action.event.threadId) {
            return state
          }

          const context = action.event.context ?? action.context ?? ""
          const prompt = action.event.prompt ?? node.text
          const provider = action.event.provider ?? "codex"
          const providerThreadId = action.event.providerThreadId ?? existingThread?.providerThreadId ?? null
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
            panelOpen: state.panelOpen,
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
                    content: prompt,
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
                prompt,
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
          if (context.thread.messages[messageIndex].status === "complete") return state
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
          const expectedIds = countPatchDrafts(action.event.patch)
          if ((action.generatedIds?.length ?? 0) !== expectedIds) return state
          const patchKey = createPatchKey(action.event)
          if (
            context.thread.events.some(
              (event) => event.type === "outline-output" && event.patchKey === patchKey,
            )
          ) {
            return state
          }

          const withPatch = applyOutlinePatch(state, action.event.patch, action.generatedIds ?? [], {
            index: 0,
          })
          if (withPatch === state) return state

          const thread = withPatch.threads[context.thread.id]
          return withUndo(state, {
            ...withPatch,
            threads: {
              ...withPatch.threads,
              [context.thread.id]: {
                ...thread,
                events: [
                  ...thread.events,
                  {
                    type: "outline-output",
                    output: action.event.patch,
                    runId: action.event.runId,
                    patchKey,
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
          const next: OutlineState = {
            ...state,
            nodes: {
              ...state.nodes,
              [context.node.id]: {
                ...context.node,
                runStatus: "succeeded" as const,
                activeRunId: undefined,
              },
            },
            threads: {
              ...state.threads,
              [context.thread.id]: markThreadActivity(
                state,
                {
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
                action.createdAt,
              ),
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
          return { ...next, undoStack: syncTerminalRunIntoUndoStack(next, action.event.runId) }
        }
        case "run-failed": {
          const context = getRunContext(state, action.event.runId)
          if (!context) return state
          if (!isActiveRunContext(context, action.event.runId)) return state
          const next: OutlineState = {
            ...state,
            nodes: {
              ...state.nodes,
              [context.node.id]: {
                ...context.node,
                runStatus: "failed" as const,
                activeRunId: undefined,
              },
            },
            threads: {
              ...state.threads,
              [context.thread.id]: markThreadActivity(
                state,
                {
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
                action.createdAt,
              ),
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
          return { ...next, undoStack: syncTerminalRunIntoUndoStack(next, action.event.runId) }
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
          const completedEvent = {
            type: "tool-completed" as const,
            toolCallId: event.toolCallId,
            name: event.name ?? startedName,
            runId: event.runId,
            output: event.output,
            createdAt: action.createdAt,
          }
          const startedEventIndex = context.thread.events.findIndex(
            (threadEvent) =>
              threadEvent.type === "tool-started" &&
              threadEvent.runId === event.runId &&
              threadEvent.toolCallId === event.toolCallId,
          )
          return {
            ...state,
            threads: {
              ...state.threads,
              [context.thread.id]: {
                ...context.thread,
                events:
                  startedEventIndex === -1
                    ? [...context.thread.events, completedEvent]
                    : context.thread.events.map((threadEvent, index) =>
                        index === startedEventIndex ? completedEvent : threadEvent,
                      ),
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
          [action.threadId]: markThreadActivity(
            state,
            {
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
            action.createdAt,
          ),
        },
      })
    }
    default:
      return state
  }
}
