import type { BulletId, BulletNode, OutlineState } from "./types"

type StackItem = {
  depth: number
  id: BulletId
}

function createBullet(id: BulletId, text: string, parentId: BulletId | null): BulletNode {
  return {
    id,
    parentId,
    children: [],
    text,
    collapsed: false,
    runStatus: "idle",
    metadata: {},
  }
}

function parseBulletLine(line: string): { depth: number; text: string } | null {
  const match = /^(\t*)-\s*(.*)$/.exec(line)
  if (!match) return null
  return {
    depth: match[1].length,
    text: match[2].trim(),
  }
}

export function createOutlineStateFromPlainText(text: string): OutlineState {
  const rootIds: BulletId[] = []
  const nodes: Record<BulletId, BulletNode> = {}
  const stack: StackItem[] = []
  let sequence = 0

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue

    const parsed = parseBulletLine(rawLine)
    if (!parsed) continue

    const previousDepth = stack.at(-1)?.depth ?? -1
    if (parsed.depth > previousDepth + 1) {
      throw new Error(
        `Line ${index + 1} cannot jump from depth ${Math.max(previousDepth, 0)} to depth ${parsed.depth}.`,
      )
    }

    while (stack.length > parsed.depth) {
      stack.pop()
    }

    sequence += 1
    const id = `seed-${sequence}`
    const parentId = parsed.depth === 0 ? null : stack[parsed.depth - 1]?.id ?? null
    nodes[id] = createBullet(id, parsed.text, parentId)

    if (parentId) {
      nodes[parentId].children = [...nodes[parentId].children, id]
    } else {
      rootIds.push(id)
    }

    stack[parsed.depth] = { depth: parsed.depth, id }
  }

  if (rootIds.length === 0) {
    return {
      rootIds: ["root"],
      focusedNodeId: "root",
      selectedThreadId: null,
      chatFocusRequest: 0,
      panelOpen: false,
      threads: {},
      runs: {},
      undoStack: [],
      nodes: {
        root: createBullet("root", "", null),
      },
    }
  }

  return {
    rootIds,
    focusedNodeId: rootIds[0],
    selectedThreadId: null,
    chatFocusRequest: 0,
    panelOpen: false,
    threads: {},
    runs: {},
    undoStack: [],
    nodes,
  }
}
