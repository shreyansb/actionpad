import { getVisibleRows } from "../domain/visibleTree"
import { useOutlineStore } from "../store/useOutlineStore"
import { BulletRow } from "./BulletRow"
import { DragLayer } from "./DragLayer"

export function OutlineView() {
  const { state } = useOutlineStore()
  const rows = getVisibleRows(state)

  return (
    <DragLayer>
      <div className="outline" aria-label="Executable outline">
        {rows.map((row) => (
          <BulletRow key={row.id} nodeId={row.id} depth={row.depth} />
        ))}
      </div>
    </DragLayer>
  )
}
