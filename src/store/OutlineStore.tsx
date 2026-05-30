import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react"
import type { Dispatch, ReactNode } from "react"
import { buildRunContext } from "../domain/context"
import { createInitialOutlineState } from "../domain/fixtures"
import type { BulletId, OutlineState } from "../domain/types"
import { ActionpadRuntimeClient, getRuntimeUrl } from "../runtimeClient/runtimeClient"
import { outlineReducer, type OutlineAction } from "./outlineReducer"

type OutlineStoreValue = {
  state: OutlineState
  dispatch: Dispatch<OutlineAction>
  executeNode: (nodeId: BulletId) => void
}

const OutlineStoreContext = createContext<OutlineStoreValue | null>(null)

let idSequence = 0

function nextId(prefix: string): string {
  idSequence += 1
  return `${prefix}-${Date.now()}-${idSequence}-${Math.random().toString(36).slice(2, 8)}`
}

export function OutlineStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(outlineReducer, undefined, createInitialOutlineState)
  const runtimeClientRef = useRef<ActionpadRuntimeClient | null>(null)

  if (!runtimeClientRef.current) {
    runtimeClientRef.current = new ActionpadRuntimeClient(getRuntimeUrl())
  }

  useEffect(
    () =>
      runtimeClientRef.current?.subscribe((event) => {
        const generatedIds =
          event.type === "outline-patch" && event.patch.type === "append-child-bullets"
            ? event.patch.bullets.map(() => nextId("generated"))
            : undefined
        dispatch({
          type: "runtime-event",
          event,
          createdAt: event.createdAt,
          generatedIds,
        })
        if (event.type === "run-started") {
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

      const context = buildRunContext(nodeId, state)
      dispatch({ type: "open-panel" })
      dispatch({ type: "request-chat-focus" })

      runtimeClientRef.current
        ?.startRun({
          provider: "codex",
          nodeId,
          prompt: node.text,
          context,
          outline: {
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
          },
        })
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Actionpad runtime is not running. Start the runtime and try again."
          console.error(message)
        })
    },
    [state],
  )

  const value = useMemo(() => ({ state, dispatch, executeNode }), [state, executeNode])

  return <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>
}

export function useOutlineStore(): OutlineStoreValue {
  const value = useContext(OutlineStoreContext)
  if (!value) {
    throw new Error("useOutlineStore must be used inside OutlineStoreProvider")
  }
  return value
}
