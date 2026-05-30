import { getVisibleRows } from "../domain/visibleTree"
import { useOutlineStore } from "../store/OutlineStore"
import { BulletRow } from "./BulletRow"

export function OutlineView() {
  const { state } = useOutlineStore()
  const rows = getVisibleRows(state)

  return (
    <div className="outline" aria-label="Executable outline">
      {rows.map((row) => (
        <BulletRow key={row.id} nodeId={row.id} depth={row.depth} />
      ))}
    </div>
  )
}
