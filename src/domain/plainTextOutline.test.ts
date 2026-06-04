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

  it("parses open and closed bullet markers without keeping them in the text", () => {
    const state = createOutlineStateFromPlainText([
      "- [closed] Project",
      "\t- [open] Next action",
      "\t- Plain child",
      "- [closed] Second root",
    ].join("\n"))

    expect(state.nodes["seed-1"].text).toBe("Project")
    expect(state.nodes["seed-1"].collapsed).toBe(true)
    expect(state.nodes["seed-2"].text).toBe("Next action")
    expect(state.nodes["seed-2"].collapsed).toBe(false)
    expect(state.nodes["seed-3"].text).toBe("Plain child")
    expect(state.nodes["seed-3"].collapsed).toBe(false)
    expect(state.nodes["seed-4"].text).toBe("Second root")
    expect(state.nodes["seed-4"].collapsed).toBe(true)
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

  it("loads outline.txt as a structurally valid default outline", () => {
    const state = createDefaultOutlineState()

    expect(state.rootIds.length).toBeGreaterThan(0)
    expect(state.focusedNodeId).toBe(state.rootIds[0])

    const visited = new Set<string>()
    const visit = (nodeId: string) => {
      expect(visited.has(nodeId)).toBe(false)
      visited.add(nodeId)

      const node = state.nodes[nodeId]
      expect(node).toBeDefined()
      expect(node.text.trim()).not.toBe("")

      for (const childId of node.children) {
        expect(state.nodes[childId]?.parentId).toBe(nodeId)
        visit(childId)
      }
    }

    for (const rootId of state.rootIds) {
      expect(state.nodes[rootId]?.parentId).toBeNull()
      visit(rootId)
    }

    expect(visited.size).toBe(Object.keys(state.nodes).length)
  })
})
