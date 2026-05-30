import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import { collapseNode } from "./treeOps"
import { getAdjacentVisibleNodeId, getVisibleRows } from "./visibleTree"

describe("getVisibleRows", () => {
  it("flattens the tree with depth", () => {
    const rows = getVisibleRows(createInitialOutlineState())
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ["root-project", 0],
      ["research", 1],
      ["research-products", 2],
      ["ui-exploration", 1],
    ])
  })

  it("hides descendants of collapsed nodes", () => {
    const state = collapseNode(createInitialOutlineState(), "research")
    const rows = getVisibleRows(state)
    expect(rows.map((row) => row.id)).toEqual(["root-project", "research", "ui-exploration"])
  })

  it("skips missing root and child node ids", () => {
    const state = createInitialOutlineState()
    const rows = getVisibleRows({
      ...state,
      rootIds: ["missing-root", ...state.rootIds],
      nodes: {
        ...state.nodes,
        "root-project": {
          ...state.nodes["root-project"],
          children: ["research", "missing-child", "ui-exploration"],
        },
      },
    })

    expect(rows.map((row) => row.id)).toEqual([
      "root-project",
      "research",
      "research-products",
      "ui-exploration",
    ])
  })
})

describe("getAdjacentVisibleNodeId", () => {
  it("returns previous and next visible ids in order", () => {
    const state = createInitialOutlineState()

    expect(getAdjacentVisibleNodeId(state, "research", "previous")).toBe("root-project")
    expect(getAdjacentVisibleNodeId(state, "research", "next")).toBe("research-products")
  })

  it("returns null at first and last boundaries", () => {
    const state = createInitialOutlineState()

    expect(getAdjacentVisibleNodeId(state, "root-project", "previous")).toBeNull()
    expect(getAdjacentVisibleNodeId(state, "ui-exploration", "next")).toBeNull()
  })

  it("skips descendants hidden under a collapsed node", () => {
    const state = collapseNode(createInitialOutlineState(), "research")

    expect(getAdjacentVisibleNodeId(state, "research", "next")).toBe("ui-exploration")
    expect(getAdjacentVisibleNodeId(state, "ui-exploration", "previous")).toBe("research")
  })

  it("returns null for an unknown current id", () => {
    expect(getAdjacentVisibleNodeId(createInitialOutlineState(), "missing-node", "next")).toBeNull()
  })
})
