import type { BulletDraft, BulletId, BulletNode, OutlineState, ThreadId } from "./types"

type DraftWithId = BulletDraft & { id: BulletId }

function cloneNode(node: BulletNode): BulletNode {
  return { ...node, children: [...node.children], metadata: { ...node.metadata } }
}

function cloneThread(thread: OutlineState["threads"][string]): OutlineState["threads"][string] {
  return {
    ...thread,
    messages: [...thread.messages],
    events: [...thread.events],
    runs: [...thread.runs],
  }
}

function cloneState(state: OutlineState): OutlineState {
  return {
    ...state,
    rootIds: [...state.rootIds],
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, node]) => [id, cloneNode(node)]),
    ),
    threads: Object.fromEntries(
      Object.entries(state.threads).map(([threadId, thread]) => [threadId, cloneThread(thread)]),
    ),
    runs: Object.fromEntries(
      Object.entries(state.runs).map(([runId, run]) => [
        runId,
        { ...run, providerMetadata: { ...run.providerMetadata } },
      ]),
    ),
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

function collectSubtreeIds(state: OutlineState, nodeId: BulletId): Set<BulletId> {
  const ids = new Set<BulletId>()

  function visit(id: BulletId) {
    const node = state.nodes[id]
    if (!node || ids.has(id)) return
    ids.add(id)
    node.children.forEach(visit)
  }

  visit(nodeId)
  return ids
}

export function updateNodeText(state: OutlineState, nodeId: BulletId, text: string): OutlineState {
  if (!state.nodes[nodeId]) return state
  if (state.nodes[nodeId].text === text) return state
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
  if (state.nodes[draft.id]) return state
  const next = cloneState(state)
  const siblings = siblingsFor(next, afterNodeId)
  const index = siblings.indexOf(afterNodeId)
  const nextSiblings = [...siblings.slice(0, index + 1), draft.id, ...siblings.slice(index + 1)]
  next.nodes[draft.id] = createBullet(draft.id, node.parentId, draft.text)
  replaceSiblings(next, node.parentId, nextSiblings)
  next.focusedNodeId = draft.id
  return next
}

export function deleteNode(
  state: OutlineState,
  nodeId: BulletId,
  focusNodeId: BulletId | null,
): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  if (!node.parentId && state.rootIds.length <= 1) return state

  const deletedIds = collectSubtreeIds(state, nodeId)
  const next = cloneState(state)
  const oldSiblings = siblingsFor(next, nodeId).filter((id) => id !== nodeId)
  replaceSiblings(next, node.parentId, oldSiblings)

  for (const id of deletedIds) {
    delete next.nodes[id]
  }

  let selectedThreadDeleted = false
  const deletedThreadIds = new Set<ThreadId>()
  for (const [threadId, thread] of Object.entries(next.threads)) {
    if (deletedIds.has(thread.nodeId)) {
      delete next.threads[threadId]
      deletedThreadIds.add(threadId)
      if (threadId === state.selectedThreadId) selectedThreadDeleted = true
    }
  }

  for (const [runId, run] of Object.entries(next.runs)) {
    if (deletedThreadIds.has(run.threadId) || deletedIds.has(run.nodeId)) {
      delete next.runs[runId]
    }
  }

  next.focusedNodeId = focusNodeId && next.nodes[focusNodeId] ? focusNodeId : null
  if (selectedThreadDeleted) {
    next.selectedThreadId = null
    next.panelOpen = false
  }

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

export function moveNode(
  state: OutlineState,
  nodeId: BulletId,
  direction: "up" | "down",
): OutlineState {
  const node = state.nodes[nodeId]
  if (!node) return state
  const siblings = siblingsFor(state, nodeId)
  const index = siblings.indexOf(nodeId)
  const targetIndex = direction === "up" ? index - 1 : index + 1
  if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) return state

  const next = cloneState(state)
  const nextSiblings = siblingsFor(next, nodeId)
  const targetSibling = nextSiblings[targetIndex]
  nextSiblings[targetIndex] = nextSiblings[index]
  nextSiblings[index] = targetSibling
  replaceSiblings(next, node.parentId, nextSiblings)
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
  if (targetParentId === node.parentId) return state
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
  const draftIds = new Set<BulletId>()
  function collectDraftIds(draft: DraftWithId): boolean {
    if (state.nodes[draft.id] || draftIds.has(draft.id)) return false
    draftIds.add(draft.id)
    return (draft.children ?? []).every((child) => collectDraftIds(child as DraftWithId))
  }
  for (const draft of drafts) {
    if (!collectDraftIds(draft)) return state
  }

  const next = cloneState(state)
  function appendDraft(parent: BulletId, draft: DraftWithId) {
    next.nodes[draft.id] = createBullet(draft.id, parent, draft.text, {
      ...(draft.metadata ?? {}),
      generated: true,
    })
    next.nodes[parent].children.push(draft.id)
    for (const child of draft.children ?? []) {
      appendDraft(draft.id, child as DraftWithId)
    }
  }
  for (const draft of drafts) {
    appendDraft(parentId, draft)
  }
  next.nodes[parentId].collapsed = false
  return next
}

export function collapseNode(state: OutlineState, nodeId: BulletId): OutlineState {
  if (!state.nodes[nodeId]) return state
  if (state.nodes[nodeId].collapsed) return state
  const next = cloneState(state)
  next.nodes[nodeId].collapsed = true
  return next
}

export function expandNode(state: OutlineState, nodeId: BulletId): OutlineState {
  if (!state.nodes[nodeId]) return state
  if (!state.nodes[nodeId].collapsed) return state
  const next = cloneState(state)
  next.nodes[nodeId].collapsed = false
  return next
}
