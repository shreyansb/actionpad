import type { BulletId, OutlineState } from "./types"

export type BulletUnreadState = "none" | "self" | "descendant"

export function isThreadUnread(
  thread: Pick<OutlineState["threads"][string], "lastActivityAt" | "lastSeenAt"> | undefined,
): boolean {
  return Boolean(thread && (thread.lastActivityAt ?? 0) > (thread.lastSeenAt ?? 0))
}

export function getBulletUnreadState(state: OutlineState, nodeId: BulletId): BulletUnreadState {
  const node = state.nodes[nodeId]
  if (!node) return "none"
  if (node.threadId && isThreadUnread(state.threads[node.threadId])) return "self"

  const visited = new Set<BulletId>()

  function hasUnreadDescendant(currentNodeId: BulletId): boolean {
    if (visited.has(currentNodeId)) return false
    visited.add(currentNodeId)

    const currentNode = state.nodes[currentNodeId]
    if (!currentNode) return false

    return currentNode.children.some((childId) => {
      const child = state.nodes[childId]
      if (!child) return false
      if (child.threadId && isThreadUnread(state.threads[child.threadId])) return true
      return hasUnreadDescendant(childId)
    })
  }

  return hasUnreadDescendant(nodeId) ? "descendant" : "none"
}
