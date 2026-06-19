import { isBulletUnread } from "./unread"
import type { BulletId, OutlineState } from "./types"

function timestampFromNodeId(nodeId: BulletId): number | null {
  const match = /^(?:node|generated)-(\d{13,})-/.exec(nodeId)
  if (!match) return null
  const timestamp = Number(match[1])
  return Number.isFinite(timestamp) ? timestamp : null
}

function formatBulletTimestamp(timestamp: number | null): string {
  return timestamp === null ? "Unknown" : new Date(timestamp).toLocaleString()
}

function getFirstRunInfo(state: OutlineState, nodeId: BulletId): { createdAt: number; runId: string | null } | null {
  const node = state.nodes[nodeId]
  const thread = node.threadId ? state.threads[node.threadId] : null
  const eventTimestamps =
    thread?.events
      .filter((event) => event.type === "run-started" && event.nodeId === nodeId)
      .map((event) => ({ createdAt: event.createdAt, runId: event.runId ?? null })) ?? []
  const runTimestamps = Object.values(state.runs)
    .filter((run) => run.nodeId === nodeId)
    .map((run) => ({ createdAt: run.createdAt, runId: run.id }))
  const timestamps = [...eventTimestamps, ...runTimestamps].filter((entry) =>
    Number.isFinite(entry.createdAt),
  )

  return timestamps.length > 0
    ? timestamps.sort((left, right) => left.createdAt - right.createdAt)[0]
    : null
}

export function getBulletHoverTitle(state: OutlineState, nodeId: BulletId): string {
  const createdAt = timestampFromNodeId(nodeId)
  const firstRun = getFirstRunInfo(state, nodeId)
  const lines = [
    `Created: ${formatBulletTimestamp(createdAt)}`,
    `First run: ${firstRun === null ? "Not run yet" : formatBulletTimestamp(firstRun.createdAt)}`,
    `Bullet ID: ${nodeId}`,
  ]

  if (firstRun?.runId) {
    lines.push(`Run ID: ${firstRun.runId}`)
  }

  return lines.join("\n")
}

function countRunningDescendants(state: OutlineState, nodeId: BulletId): number {
  const node = state.nodes[nodeId]
  if (!node) return 0
  return node.children.reduce((count, childId) => {
    const child = state.nodes[childId]
    if (!child) return count
    return count + (child.runStatus === "running" ? 1 : 0) + countRunningDescendants(state, childId)
  }, 0)
}

export function getHiddenRunningDescendantCount(state: OutlineState, nodeId: BulletId): number {
  const node = state.nodes[nodeId]
  return node?.collapsed ? countRunningDescendants(state, nodeId) : 0
}

export function findFirstUnreadDescendantPath(state: OutlineState, nodeId: BulletId): BulletId[] | null {
  const node = state.nodes[nodeId]
  if (!node) return null

  for (const childId of node.children) {
    const child = state.nodes[childId]
    if (!child) continue
    if (isBulletUnread(child.metadata)) return [nodeId, childId]
    const childPath = findFirstUnreadDescendantPath(state, childId)
    if (childPath) return [nodeId, ...childPath]
  }

  return null
}

export function hasGeneratedChildOutput(state: OutlineState, nodeId: BulletId): boolean {
  const node = state.nodes[nodeId]
  if (!node) return false
  return node.children.some((childId) => state.nodes[childId]?.metadata.generated === true)
}
