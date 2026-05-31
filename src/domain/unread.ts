import type { BulletId, OutlineState } from "./types"

export type BulletUnreadState = "none" | "self" | "descendant"

export function isBulletUnread(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.unread === true
}

export function getBulletUnreadState(state: OutlineState, nodeId: BulletId): BulletUnreadState {
  const node = state.nodes[nodeId]
  if (!node) return "none"
  if (isBulletUnread(node.metadata)) return "self"
  if (!node.collapsed) return "none"

  const visited = new Set<BulletId>()

  function hasUnreadDescendant(currentNodeId: BulletId): boolean {
    if (visited.has(currentNodeId)) return false
    visited.add(currentNodeId)

    const currentNode = state.nodes[currentNodeId]
    if (!currentNode) return false

    return currentNode.children.some((childId) => {
      const child = state.nodes[childId]
      if (!child) return false
      if (isBulletUnread(child.metadata)) return true
      return hasUnreadDescendant(childId)
    })
  }

  return hasUnreadDescendant(nodeId) ? "descendant" : "none"
}
