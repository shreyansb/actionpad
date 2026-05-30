import type { BulletId, OutlineState } from "./types"

export type VisibleRow = {
  id: BulletId
  depth: number
}

export function getVisibleRows(state: OutlineState): VisibleRow[] {
  const rows: VisibleRow[] = []

  function visit(ids: BulletId[], depth: number) {
    for (const id of ids) {
      const node = state.nodes[id]
      if (!node) continue
      rows.push({ id, depth })
      if (!node.collapsed && node.children.length > 0) {
        visit(node.children, depth + 1)
      }
    }
  }

  visit(state.rootIds, 0)
  return rows
}

export function getAdjacentVisibleNodeId(
  state: OutlineState,
  currentId: BulletId,
  direction: "previous" | "next",
): BulletId | null {
  const rows = getVisibleRows(state)
  const index = rows.findIndex((row) => row.id === currentId)
  if (index === -1) return null
  const nextIndex = direction === "previous" ? index - 1 : index + 1
  return rows[nextIndex]?.id ?? null
}
