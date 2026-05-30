import type { BulletDraft, BulletId, OutlineState, OutlineUndoSnapshot, ThreadId } from "../domain/types"
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
