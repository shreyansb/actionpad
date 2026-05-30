import { createContext, useCallback, useContext, useMemo, useReducer } from "react"
import type { Dispatch, ReactNode } from "react"
import { buildRunContext } from "../domain/context"
import { createInitialOutlineState } from "../domain/fixtures"
import { createSimulatedOutput } from "../domain/runner"
import type { BulletId, OutlineState } from "../domain/types"
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

  const executeNode = useCallback(
    (nodeId: BulletId) => {
      const node = state.nodes[nodeId]
      if (!node) return

      if (node.threadId) {
        dispatch({ type: "select-thread", threadId: node.threadId })
        dispatch({ type: "open-panel" })
        return
      }

      const threadId = nextId("thread")
      const context = buildRunContext(nodeId, state)
      const startedAt = Date.now()
      dispatch({ type: "run-started", nodeId, threadId, context, createdAt: startedAt })

      window.setTimeout(() => {
        const output = createSimulatedOutput(context)
        dispatch({
          type: "run-completed",
          nodeId,
          threadId,
          assistantMessage: output.assistantMessage,
          bullets: output.bullets.map((bullet) => ({
            ...bullet,
            id: nextId("generated"),
          })),
          createdAt: Date.now(),
        })
      }, 1000)
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
