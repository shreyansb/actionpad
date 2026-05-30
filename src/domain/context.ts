import type { BulletId, BulletNode, OutlineState } from "./types"

export function buildRunContext(nodeId: BulletId, outline: OutlineState): string {
  const path: string[] = []
  let cursor: BulletId | null = nodeId

  while (cursor) {
    const node: BulletNode | undefined = outline.nodes[cursor]
    if (!node) return ""
    path.unshift(node.text)
    cursor = node.parentId
  }

  return path.join("\n")
}
