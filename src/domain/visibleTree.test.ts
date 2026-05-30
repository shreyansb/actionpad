import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import { collapseNode } from "./treeOps"
import { getVisibleRows } from "./visibleTree"

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
})
