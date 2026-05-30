import type { BulletId, BulletNode, OutlineState } from "./types"

export function buildRunContext(nodeId: BulletId, outline: OutlineState): string {
  const path: string[] = []
  const visited = new Set<BulletId>()
  let cursor: BulletId | null = nodeId

  while (cursor) {
    if (visited.has(cursor)) return ""
    visited.add(cursor)

    const node: BulletNode | undefined = outline.nodes[cursor]
    if (!node) return ""
    path.unshift(node.text)
    cursor = node.parentId
  }

  return path.join("\n")
}
