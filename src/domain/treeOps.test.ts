import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "./fixtures"
import {
  appendChildBullets,
  collapseNode,
  deleteNode,
  expandNode,
  indentNode,
  insertSiblingAfter,
  moveNode,
  outdentNode,
  reparentNode,
  restoreDeletedNode,
  updateNodeText,
} from "./treeOps"

describe("treeOps", () => {
  it("updates node text without changing structure", () => {
    const state = createInitialOutlineState()
    const next = updateNodeText(state, "research-products", "Find outliner references")
    expect(next.nodes["research-products"].text).toBe("Find outliner references")
    expect(next.nodes.research.children).toEqual(["research-products"])
  })

  it("inserts a sibling after an existing node", () => {
    const state = createInitialOutlineState()
    const next = insertSiblingAfter(state, "research", {
      id: "new-sibling",
      text: "Frontend plan",
    })
    expect(next.rootIds).toEqual(["root-project"])
    expect(next.nodes["root-project"].children).toEqual(["research", "new-sibling", "ui-exploration"])
    expect(next.nodes["new-sibling"].parentId).toBe("root-project")
  })

  it("does not insert a sibling when the draft id already exists", () => {
    const state = createInitialOutlineState()
    const next = insertSiblingAfter(state, "research", {
      id: "ui-exploration",
      text: "Duplicate id",
    })
    expect(next).toBe(state)
  })

  it("deletes a node and focuses the requested surviving node", () => {
    const state = createInitialOutlineState()
    const next = deleteNode(state, "research-products", "research")

    expect(next.nodes["research-products"]).toBeUndefined()
    expect(next.nodes.research.children).toEqual([])
    expect(next.focusedNodeId).toBe("research")
    expect(next.lastDeletedNode?.nodeId).toBe("research-products")
    expect(state.nodes["research-products"]).toBeDefined()
  })

  it("deletes a node subtree", () => {
    const state = createInitialOutlineState()
    const withChild = insertSiblingAfter(state, "research-products", {
      id: "research-sibling",
      text: "Sibling",
    })
    const nested = indentNode(withChild, "research-sibling")

    const next = deleteNode(nested, "research-products", "research")

    expect(next.nodes["research-products"]).toBeUndefined()
    expect(next.nodes["research-sibling"]).toBeUndefined()
    expect(next.nodes.research.children).toEqual([])
  })

  it("restores the last deleted node subtree", () => {
    const state = createInitialOutlineState()
    const withChild = insertSiblingAfter(state, "research-products", {
      id: "research-sibling",
      text: "Sibling",
    })
    const nested = indentNode(withChild, "research-sibling")
    const deleted = deleteNode(nested, "research-products", "research")

    const restored = restoreDeletedNode(deleted)

    expect(restored.nodes["research-products"].parentId).toBe("research")
    expect(restored.nodes["research-sibling"].parentId).toBe("research-products")
    expect(restored.nodes.research.children).toEqual(["research-products"])
    expect(restored.focusedNodeId).toBe("research-products")
    expect(restored.lastDeletedNode).toBeNull()
  })

  it("keeps the last root node so the outline is never empty", () => {
    const state = createInitialOutlineState()
    const next = deleteNode(state, "root-project", null)

    expect(next).toBe(state)
  })

  it("indents a node under its previous sibling", () => {
    const state = createInitialOutlineState()
    const next = indentNode(state, "ui-exploration")
    expect(next.nodes["ui-exploration"].parentId).toBe("research")
    expect(next.nodes.research.children).toEqual(["research-products", "ui-exploration"])
    expect(next.nodes["root-project"].children).toEqual(["research"])
    expect(state.nodes["ui-exploration"].parentId).toBe("root-project")
    expect(state.nodes.research.children).toEqual(["research-products"])
    expect(state.nodes["root-project"].children).toEqual(["research", "ui-exploration"])
  })

  it("outdents a node to its grandparent after its parent", () => {
    const state = createInitialOutlineState()
    const next = outdentNode(state, "research-products")
    expect(next.nodes["research-products"].parentId).toBe("root-project")
    expect(next.nodes["root-project"].children).toEqual([
      "research",
      "research-products",
      "ui-exploration",
    ])
    expect(next.nodes.research.children).toEqual([])
  })

  it("moves a node up and down within its siblings", () => {
    const state = createInitialOutlineState()
    const movedUp = moveNode(state, "ui-exploration", "up")
    expect(movedUp.nodes["root-project"].children).toEqual(["ui-exploration", "research"])

    const movedDown = moveNode(movedUp, "ui-exploration", "down")
    expect(movedDown.nodes["root-project"].children).toEqual(["research", "ui-exploration"])
    expect(state.nodes["root-project"].children).toEqual(["research", "ui-exploration"])
  })

  it("does not move a node past sibling boundaries", () => {
    const state = createInitialOutlineState()

    expect(moveNode(state, "research", "up")).toBe(state)
    expect(moveNode(state, "ui-exploration", "down")).toBe(state)
  })

  it("reparents a node as the last child of a target parent", () => {
    const state = createInitialOutlineState()
    const next = reparentNode(state, "ui-exploration", "research")
    expect(next.nodes["ui-exploration"].parentId).toBe("research")
    expect(next.nodes.research.children).toEqual(["research-products", "ui-exploration"])
  })

  it("does not reparent a node when the target parent is already current parent", () => {
    const state = createInitialOutlineState()
    const next = reparentNode(state, "research", "root-project")
    expect(next).toBe(state)
  })

  it("prevents reparenting a node under its own descendant", () => {
    const state = createInitialOutlineState()
    const next = reparentNode(state, "research", "research-products")
    expect(next).toBe(state)
  })

  it("appends generated child bullets", () => {
    const state = createInitialOutlineState()
    const next = appendChildBullets(state, "research-products", [
      { id: "generated-1", text: "Workflowy is a close UI reference." },
      { id: "generated-2", text: "Taskade is a close agent-task reference." },
    ])
    expect(next.nodes["research-products"].children).toEqual(["generated-1", "generated-2"])
    expect(next.nodes["generated-1"].metadata.generated).toBe(true)
  })

  it("does not append child bullets when a draft id already exists", () => {
    const state = createInitialOutlineState()
    const next = appendChildBullets(state, "research-products", [
      { id: "generated-1", text: "New child" },
      { id: "ui-exploration", text: "Existing id" },
    ])
    expect(next).toBe(state)
    expect(state.nodes["research-products"].children).toEqual([])
    expect(state.nodes["generated-1"]).toBeUndefined()
  })

  it("does not append child bullets when draft ids contain duplicates", () => {
    const state = createInitialOutlineState()
    const next = appendChildBullets(state, "research-products", [
      { id: "generated-1", text: "First child" },
      { id: "generated-1", text: "Duplicate child" },
    ])
    expect(next).toBe(state)
    expect(state.nodes["research-products"].children).toEqual([])
    expect(state.nodes["generated-1"]).toBeUndefined()
  })

  it("keeps generated metadata true when draft metadata includes generated false", () => {
    const state = createInitialOutlineState()
    const next = appendChildBullets(state, "research-products", [
      {
        id: "generated-with-source",
        text: "Preserve source metadata.",
        metadata: { generated: false, source: "test" },
      },
    ])
    expect(next.nodes["generated-with-source"].metadata.generated).toBe(true)
    expect(next.nodes["generated-with-source"].metadata.source).toBe("test")
  })

  it("collapses and expands nodes", () => {
    const state = createInitialOutlineState()
    expect(collapseNode(state, "research").nodes.research.collapsed).toBe(true)
    expect(expandNode(collapseNode(state, "research"), "research").nodes.research.collapsed).toBe(
      false,
    )
  })
})
