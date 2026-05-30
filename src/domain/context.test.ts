import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import { buildRunContext } from "./context"

describe("buildRunContext", () => {
  it("returns ancestor text from root to current node", () => {
    expect(buildRunContext("research-products", createInitialOutlineState())).toBe(
      [
        "Executable Outliner Prototype",
        "Research",
        "Find adjacent products and patterns",
      ].join("\n"),
    )
  })

  it("returns an empty string for an unknown node", () => {
    expect(buildRunContext("missing", createInitialOutlineState())).toBe("")
  })
})
