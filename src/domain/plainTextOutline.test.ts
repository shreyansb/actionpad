import { describe, expect, it } from "vitest"
import { createDefaultOutlineState } from "./fixtures"
import { createOutlineStateFromPlainText } from "./plainTextOutline"

describe("plainTextOutline", () => {
  it("creates an outline state from dash bullets and tab-indented children", () => {
    const state = createOutlineStateFromPlainText([
      "- Project",
      "\t- Next action",
      "\t\t- Detail",
      "- Second root",
    ].join("\n"))

    expect(state.rootIds).toEqual(["seed-1", "seed-4"])
    expect(state.focusedNodeId).toBe("seed-1")
    expect(state.nodes["seed-1"].text).toBe("Project")
    expect(state.nodes["seed-1"].parentId).toBeNull()
    expect(state.nodes["seed-1"].children).toEqual(["seed-2"])
    expect(state.nodes["seed-2"].text).toBe("Next action")
    expect(state.nodes["seed-2"].parentId).toBe("seed-1")
    expect(state.nodes["seed-2"].children).toEqual(["seed-3"])
    expect(state.nodes["seed-3"].text).toBe("Detail")
    expect(state.nodes["seed-4"].text).toBe("Second root")
  })

  it("ignores blank lines and falls back to a blank outline when there are no bullets", () => {
    const state = createOutlineStateFromPlainText(["", "  ", "notes without bullets"].join("\n"))

    expect(state.rootIds).toEqual(["root"])
    expect(state.nodes.root.text).toBe("")
  })

  it("rejects indentation jumps that skip a parent level", () => {
    expect(() => createOutlineStateFromPlainText("- Project\n\t\t- Missing parent")).toThrow(
      "Line 2 cannot jump from depth 0 to depth 2.",
    )
  })

  it("loads the repo-local outline.txt as the default outline", () => {
    const state = createDefaultOutlineState()

    expect(state.rootIds).toEqual(["seed-1", "seed-10"])
    expect(state.nodes["seed-1"].text).toBe("actionpad")
    expect(state.nodes["seed-1"].children).toEqual(["seed-2", "seed-7"])
    expect(state.nodes["seed-2"].text).toBe("actionpad is a place to think, write, and take action")
    expect(state.nodes["seed-7"].text).toBe(
      "actionpad is a malleable app, for you to modify as little or as much as you want to",
    )
    expect(state.nodes["seed-10"].text).toBe("add a project folder with @")
  })
})
