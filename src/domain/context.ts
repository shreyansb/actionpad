import type { BulletId, BulletNode, OutlineState } from "./types"

export function buildRunContext(nodeId: BulletId, outline: OutlineState): string {
  const path: string[] = []
  const node = outline.nodes[nodeId]
  if (!node) return ""

  const visited = new Set<BulletId>([nodeId])
  let cursor: BulletId | null = node.parentId

  while (cursor) {
    if (visited.has(cursor)) return ""
    visited.add(cursor)

    const ancestor: BulletNode | undefined = outline.nodes[cursor]
    if (!ancestor) return ""
    path.unshift(ancestor.text)
    cursor = ancestor.parentId
  }

  return path.join("\n")
}
