import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import type { ReactNode } from "react"
import { useOutlineActions } from "../store/OutlineActionsContext"

type DragLayerProps = {
  children: ReactNode
}

export function DragLayer({ children }: DragLayerProps) {
  const { dispatch } = useOutlineActions()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId) return
    dispatch({ type: "reparent-node", nodeId: activeId, targetParentId: overId })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  )
}
