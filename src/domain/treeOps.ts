import type { BulletDraft, BulletId, BulletNode, OutlineState } from "./types"

type DraftWithId = BulletDraft & { id: BulletId }

function cloneState(state: OutlineState): OutlineState {
  return {
    ...state,
    rootIds: [...state.rootIds],
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, node]) => [
        id,
        { ...node, children: [...node.children], metadata: { ...node.metadata } },
      ]),
    ),
    threads: { ...state.threads },
  }
}

function siblingsFor(state: OutlineState, nodeId: BulletId): BulletId[] {
  const parentId = state.nodes[nodeId]?.parentId
  return parentId ? state.nodes[parentId].children : state.rootIds
}

function replaceSiblings(state: OutlineState, parentId: BulletId | null, siblings: BulletId[]) {
  if (parentId) {
    state.nodes[parentId].children = siblings
  } else {
    state.rootIds = siblings
  }
}

function createBullet(
  id: BulletId,
  parentId: BulletId | null,
  text: string,
  metadata: Record<string, unknown> = {},
): BulletNode {
  return {
    id,
    parentId,
    children: [],
    text,
    collapsed: false,
    runStatus: "idle",
    metadata,
  }
}

function isDescendant(
  state: OutlineState,
  possibleDescendantId: BulletId,
  ancestorId: BulletId,
): boolean {
  let cursor = state.nodes[possibleDescendantId]?.parentId ?? null
  while (cursor) {
    if (cursor === ancestorId) return true
    cursor = state.nodes[cursor]?.parentId ?? null
  }
  return false
}

export function updateNodeText(state: OutlineState, nodeId: BulletId, text: string): OutlineState {
  if (!state.nodes[nodeId]) return state
  const next = cloneState(state)
  next.nodes[nodeId].text = text
  return next
}

export function insertSiblingAfter(
  state: OutlineState,
  afterNodeId: BulletId,
  draft: { id: BulletId; text: string },
): OutlineState {
  const node = state.nodes[afterNodeId]
  if (!node) return state
  const next = cloneState(state)
  const siblings = siblingsFor(next, afterNodeId)
  const index = siblings.indexOf(afterNodeId)
  const nextSiblings = [...siblings.slice(0, index + 1), draft.id, ...siblings.slice(index + 1)]
  next.nodes[draft.id] = createBullet(draft.id, node.parentId, draft.text)
  replaceSiblings(next, node.parentId, nextSiblings)
  next.focusedNodeId = draft.id
  return next
}

export function indentNode(state: OutlineState, nodeId: BulletId): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  const siblings = siblingsFor(state, nodeId)
  const index = siblings.indexOf(nodeId)
  if (index <= 0) return state

  const previousSiblingId = siblings[index - 1]
  const next = cloneState(state)
  const oldSiblings = siblingsFor(next, nodeId).filter((id) => id !== nodeId)
  replaceSiblings(next, node.parentId, oldSiblings)
  next.nodes[nodeId].parentId = previousSiblingId
  next.nodes[previousSiblingId].children.push(nodeId)
  next.nodes[previousSiblingId].collapsed = false
  return next
}

export function outdentNode(state: OutlineState, nodeId: BulletId): OutlineState {
  const node = state.nodes[nodeId]
  if (!node?.parentId) return state
  const parent = state.nodes[node.parentId]
  const next = cloneState(state)
  next.nodes[parent.id].children = next.nodes[parent.id].children.filter((id) => id !== nodeId)
  next.nodes[nodeId].parentId = parent.parentId

  const targetSiblings = parent.parentId ? next.nodes[parent.parentId].children : next.rootIds
  const parentIndex = targetSiblings.indexOf(parent.id)
  const nextSiblings = [
    ...targetSiblings.slice(0, parentIndex + 1),
    nodeId,
    ...targetSiblings.slice(parentIndex + 1),
  ]
  replaceSiblings(next, parent.parentId, nextSiblings)
  return next
}

export function reparentNode(
  state: OutlineState,
  nodeId: BulletId,
  targetParentId: BulletId | null,
): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  if (targetParentId === nodeId) return state
  if (targetParentId && !state.nodes[targetParentId]) return state
  if (targetParentId && isDescendant(state, targetParentId, nodeId)) return state

  const next = cloneState(state)
  const oldSiblings = siblingsFor(next, nodeId).filter((id) => id !== nodeId)
  replaceSiblings(next, node.parentId, oldSiblings)
  next.nodes[nodeId].parentId = targetParentId
  if (targetParentId) {
    next.nodes[targetParentId].children.push(nodeId)
    next.nodes[targetParentId].collapsed = false
  } else {
    next.rootIds.push(nodeId)
  }
  return next
}

export function appendChildBullets(
  state: OutlineState,
  parentId: BulletId,
  drafts: DraftWithId[],
): OutlineState {
  if (!state.nodes[parentId]) return state
  const next = cloneState(state)
  for (const draft of drafts) {
    next.nodes[draft.id] = createBullet(draft.id, parentId, draft.text, {
      generated: true,
      ...(draft.metadata ?? {}),
    })
    next.nodes[parentId].children.push(draft.id)
  }
  next.nodes[parentId].collapsed = false
  return next
}

export function collapseNode(state: OutlineState, nodeId: BulletId): OutlineState {
  if (!state.nodes[nodeId]) return state
  const next = cloneState(state)
  next.nodes[nodeId].collapsed = true
  return next
}

export function expandNode(state: OutlineState, nodeId: BulletId): OutlineState {
  if (!state.nodes[nodeId]) return state
  const next = cloneState(state)
  next.nodes[nodeId].collapsed = false
  return next
}
