import { Profiler, useRef } from "react"
import type { ProfilerOnRenderCallback } from "react"
import {
  findFirstUnreadDescendantPath,
  getBulletHoverTitle,
  getHiddenRunningDescendantCount,
  hasGeneratedChildOutput,
} from "../domain/outlineRowDerivations"
import { getBulletUnreadState } from "../domain/unread"
import { getVisibleRows } from "../domain/visibleTree"
import type { BulletId, OutlineState } from "../domain/types"
import type { BulletUnreadState } from "../domain/unread"
import { useOutlineState } from "../store/OutlineStateContext"
import { BulletRow, BulletRowUndoStateContext } from "./BulletRow"
import { DragLayer } from "./DragLayer"
import { isActionpadPerfEnabled, measurePerf, recordPerf } from "../perf"

type RowModel = {
  id: BulletId
  depth: number
  previousVisibleNodeId: BulletId | null
  nextVisibleNodeId: BulletId | null
  unreadState: BulletUnreadState
  unreadDescendantPath: BulletId[] | null
  hiddenRunningDescendantCount: number
  hasGeneratedChildOutput: boolean
  hoverTitle: string
}

function getRowModels(state: OutlineState): RowModel[] {
  const rows = getVisibleRows(state)
  return rows.map((row, index) => {
    const unreadState = getBulletUnreadState(state, row.id)

    return {
      id: row.id,
      depth: row.depth,
      previousVisibleNodeId: rows[index - 1]?.id ?? null,
      nextVisibleNodeId: rows[index + 1]?.id ?? null,
      unreadState,
      unreadDescendantPath:
        unreadState === "descendant" ? findFirstUnreadDescendantPath(state, row.id) : null,
      hiddenRunningDescendantCount: getHiddenRunningDescendantCount(state, row.id),
      hasGeneratedChildOutput: hasGeneratedChildOutput(state, row.id),
      hoverTitle: getBulletHoverTitle(state, row.id),
    }
  })
}

export function OutlineView() {
  const outline = (
    <DragLayer>
      <OutlineRows />
    </DragLayer>
  )

  if (!isActionpadPerfEnabled()) return outline

  return (
    <Profiler id="OutlineView" onRender={recordOutlineRender}>
      {outline}
    </Profiler>
  )
}

const recordOutlineRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  recordPerf("react.commit.outline", actualDuration, {
    id,
    phase,
    baseDuration,
    startTime,
    commitTime,
  })
}

function OutlineRows() {
  const state = useOutlineState()
  const undoStateRef = useRef({
    hasUndo: false,
    hasRedo: false,
    nextUndoFocusedNodeId: null as BulletId | null,
    nextRedoFocusedNodeId: null as BulletId | null,
  })
  const rows = isActionpadPerfEnabled()
    ? measurePerf(
        "outline.getRowModels",
        {
          nodeCount: Object.keys(state.nodes).length,
          rootCount: state.rootIds.length,
        },
        () => getRowModels(state),
      )
    : getRowModels(state)
  const hasUndo = state.undoStack.length > 0
  const hasRedo = state.redoStack.length > 0
  const nextUndoFocusedNodeId = state.undoStack[state.undoStack.length - 1]?.focusedNodeId ?? null
  const nextRedoFocusedNodeId = state.redoStack[state.redoStack.length - 1]?.focusedNodeId ?? null
  undoStateRef.current = { hasUndo, hasRedo, nextUndoFocusedNodeId, nextRedoFocusedNodeId }

  return (
    <BulletRowUndoStateContext.Provider value={undoStateRef}>
      <div className="outline" aria-label="Executable outline">
        {rows.map((row) => (
          <BulletRow
            key={row.id}
            node={state.nodes[row.id]}
            depth={row.depth}
            focused={state.focusedNodeId === row.id}
            previousVisibleNodeId={row.previousVisibleNodeId}
            nextVisibleNodeId={row.nextVisibleNodeId}
            unreadState={row.unreadState}
            unreadDescendantPath={row.unreadDescendantPath}
            hiddenRunningDescendantCount={row.hiddenRunningDescendantCount}
            hasGeneratedChildOutput={row.hasGeneratedChildOutput}
            hoverTitle={row.hoverTitle}
          />
        ))}
      </div>
    </BulletRowUndoStateContext.Provider>
  )
}
