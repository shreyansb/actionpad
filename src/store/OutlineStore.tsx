import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react"
import type { Dispatch, ReactNode } from "react"
import { buildRunContext } from "../domain/context"
import { createInitialOutlineState } from "../domain/fixtures"
import type { BulletId, OutlineState } from "../domain/types"
import type { OutlinePatch, RuntimeOutlineSnapshot, SendMessageRequest, StartRunRequest } from "../domain/runtimeProtocol"
import { ActionpadRuntimeClient, getRuntimeUrl } from "../runtimeClient/runtimeClient"
import { outlineReducer, type OutlineAction } from "./outlineReducer"

type OutlineStoreValue = {
  state: OutlineState
  dispatch: Dispatch<OutlineAction>
  executeNode: (nodeId: BulletId) => void
  sendChatMessage: (threadId: string, message: string) => void
}

const OutlineStoreContext = createContext<OutlineStoreValue | null>(null)

let idSequence = 0

function nextId(prefix: string): string {
  idSequence += 1
  return `${prefix}-${Date.now()}-${idSequence}-${Math.random().toString(36).slice(2, 8)}`
}

function countDrafts(drafts: Array<{ children?: unknown[] }>): number {
  return drafts.reduce(
    (count, draft) =>
      count +
      1 +
      (Array.isArray(draft.children)
        ? countDrafts(draft.children as Array<{ children?: unknown[] }>)
        : 0),
    0,
  )
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

function toRuntimeOutline(state: OutlineState): RuntimeOutlineSnapshot {
  return {
    rootIds: state.rootIds,
    focusedNodeId: state.focusedNodeId,
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, outlineNode]) => [
        id,
        {
          id: outlineNode.id,
          parentId: outlineNode.parentId,
          children: outlineNode.children,
          text: outlineNode.text,
          collapsed: outlineNode.collapsed,
          runStatus: outlineNode.runStatus,
          threadId: outlineNode.threadId,
          activeRunId: outlineNode.activeRunId,
          metadata: outlineNode.metadata,
        },
      ]),
    ),
  }
}

export function OutlineStoreProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState?: OutlineState
}) {
  const initialStateRef = useRef(initialState)
  const [state, dispatch] = useReducer(
    outlineReducer,
    initialStateRef.current ?? createInitialOutlineState(),
  )
  const runtimeClientRef = useRef<ActionpadRuntimeClient | null>(null)
  const panelOpenRef = useRef(state.panelOpen)

  if (!runtimeClientRef.current) {
    runtimeClientRef.current = new ActionpadRuntimeClient(getRuntimeUrl())
  }

  useEffect(() => {
    panelOpenRef.current = state.panelOpen
  }, [state.panelOpen])

  useEffect(
    () =>
      runtimeClientRef.current?.subscribe((event) => {
        const generatedIds =
          event.type === "outline-patch"
            ? Array.from({ length: countPatchDrafts(event.patch) }, () => nextId("generated"))
            : undefined
        dispatch({
          type: "runtime-event",
          event,
          createdAt: event.createdAt,
          generatedIds,
        })
        if (event.type === "run-started" && panelOpenRef.current) {
          dispatch({ type: "request-chat-focus" })
        }
      }),
    [],
  )

  const executeNode = useCallback(
    (nodeId: BulletId) => {
      const node = state.nodes[nodeId]
      if (!node) return

      if (node.threadId) {
        dispatch({ type: "select-thread", threadId: node.threadId })
        dispatch({ type: "open-panel" })
        dispatch({ type: "request-chat-focus" })
        return
      }

      const threadId = nextId("thread")
      const context = buildRunContext(nodeId, state)
      const request: StartRunRequest = {
        provider: "codex",
        nodeId,
        prompt: node.text,
        context,
        outline: toRuntimeOutline(state),
      }

      runtimeClientRef.current
        ?.startRun(request)
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Actionpad runtime is not running. Start the runtime and try again."
          console.error(message)
          dispatch({
            type: "run-failed-local",
            nodeId,
            threadId,
            runId: nextId("failed-run"),
            context,
            error: "Actionpad runtime is not running. Start the runtime and try again.",
            createdAt: Date.now(),
          })
        })
    },
    [state],
  )

  const sendChatMessage = useCallback(
    (threadId: string, message: string) => {
      const thread = state.threads[threadId]
      const node = thread ? state.nodes[thread.nodeId] : null
      if (!thread || !node || node.runStatus === "running" || !message.trim()) return

      const request: SendMessageRequest = {
        provider: thread.provider,
        threadId,
        providerThreadId: thread.providerThreadId,
        nodeId: node.id,
        prompt: message,
        context: buildRunContext(node.id, state),
        outline: toRuntimeOutline(state),
      }

      runtimeClientRef.current?.sendMessage(request).catch((error) => {
        const runId = nextId("failed-run")
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Actionpad runtime is not running. Start the runtime and try again."
        console.error(errorMessage)
        dispatch({
          type: "run-failed-local",
          nodeId: node.id,
          threadId,
          runId,
          context: message,
          error: "Actionpad runtime is not running. Start the runtime and try again.",
          createdAt: Date.now(),
        })
      })
    },
    [state],
  )

  const value = useMemo(
    () => ({ state, dispatch, executeNode, sendChatMessage }),
    [state, executeNode, sendChatMessage],
  )

  return <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>
}

export function useOutlineStore(): OutlineStoreValue {
  const value = useContext(OutlineStoreContext)
  if (!value) {
    throw new Error("useOutlineStore must be used inside OutlineStoreProvider")
  }
  return value
}
