import type { BulletDraft, BulletId, OutlineState, ThreadId } from "../domain/types"
import {
  appendChildBullets,
  collapseNode,
  expandNode,
  indentNode,
  insertSiblingAfter,
  outdentNode,
  reparentNode,
  updateNodeText,
} from "../domain/treeOps"

type DraftWithId = BulletDraft & { id: BulletId }

export type OutlineAction =
  | { type: "focus-node"; nodeId: BulletId }
  | { type: "update-text"; nodeId: BulletId; text: string }
  | { type: "insert-sibling-after"; afterNodeId: BulletId; id: BulletId; text: string }
  | { type: "indent-node"; nodeId: BulletId }
  | { type: "outdent-node"; nodeId: BulletId }
  | { type: "reparent-node"; nodeId: BulletId; targetParentId: BulletId | null }
  | { type: "collapse-node"; nodeId: BulletId }
  | { type: "expand-node"; nodeId: BulletId }
  | { type: "open-panel" }
  | { type: "close-panel" }
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

export function outlineReducer(state: OutlineState, action: OutlineAction): OutlineState {
  switch (action.type) {
    case "focus-node":
      return { ...state, focusedNodeId: action.nodeId }
    case "update-text":
      return updateNodeText(state, action.nodeId, action.text)
    case "insert-sibling-after":
      return insertSiblingAfter(state, action.afterNodeId, { id: action.id, text: action.text })
    case "indent-node":
      return indentNode(state, action.nodeId)
    case "outdent-node":
      return outdentNode(state, action.nodeId)
    case "reparent-node":
      return reparentNode(state, action.nodeId, action.targetParentId)
    case "collapse-node":
      return collapseNode(state, action.nodeId)
    case "expand-node":
      return expandNode(state, action.nodeId)
    case "open-panel":
      return { ...state, panelOpen: true }
    case "close-panel":
      return { ...state, panelOpen: false }
    case "select-thread":
      return {
        ...state,
        selectedThreadId: action.threadId,
        panelOpen: action.threadId ? true : state.panelOpen,
      }
    case "run-started": {
      if (!state.nodes[action.nodeId]) return state
      const existingThread = state.threads[action.threadId]
      if (existingThread) {
        return {
          ...state,
          focusedNodeId: action.nodeId,
          selectedThreadId: action.threadId,
          panelOpen: true,
        }
      }
      return {
        ...state,
        focusedNodeId: action.nodeId,
        selectedThreadId: action.threadId,
        panelOpen: true,
        nodes: {
          ...state.nodes,
          [action.nodeId]: {
            ...state.nodes[action.nodeId],
            runStatus: "running",
            threadId: action.threadId,
          },
        },
        threads: {
          ...state.threads,
          [action.threadId]: {
            id: action.threadId,
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
          },
        },
      }
    }
    case "run-completed": {
      const node = state.nodes[action.nodeId]
      const thread = state.threads[action.threadId]
      if (!node) return state
      if (!thread) return state
      if (thread.nodeId !== action.nodeId) return state
      if (node.threadId !== action.threadId) return state

      const withChildren = appendChildBullets(state, action.nodeId, action.bullets)
      if (withChildren === state) return state

      return {
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
      }
    }
    default:
      return state
  }
}
