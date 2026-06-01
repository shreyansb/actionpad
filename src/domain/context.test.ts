import { describe, expect, it } from "vitest"
import { createSeededOutlineState as createInitialOutlineState } from "./fixtures"
import { buildRunContext } from "./context"

describe("buildRunContext", () => {
  it("returns ancestor text from root to parent node", () => {
    const context = buildRunContext("research-products", createInitialOutlineState())

    expect(context).toContain("Actionpad Prototype")
    expect(context).toBe(
      [
        "Actionpad Prototype",
        "Research",
      ].join("\n"),
    )
  })

  it("returns an empty string for a root node", () => {
    expect(buildRunContext("root-project", createInitialOutlineState())).toBe("")
  })

  it("returns an empty string for an unknown node", () => {
    expect(buildRunContext("missing", createInitialOutlineState())).toBe("")
  })

  it("returns an empty string when the parent chain is missing", () => {
    const outline = createInitialOutlineState()
    outline.nodes.research.parentId = "missing"

    expect(buildRunContext("research-products", outline)).toBe("")
  })

  it("returns an empty string for a cyclic parent chain", () => {
    const outline = createInitialOutlineState()
    outline.nodes.research.parentId = "research-products"

    expect(buildRunContext("research-products", outline)).toBe("")
  })
})
