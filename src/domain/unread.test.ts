import { describe, expect, it } from "vitest"
import { createSeededOutlineState } from "./fixtures"
import { getBulletUnreadState, isBulletUnread } from "./unread"

describe("unread state", () => {
  it("marks generated output unread from bullet metadata", () => {
    expect(isBulletUnread({ unread: true })).toBe(true)
    expect(isBulletUnread({ unread: false })).toBe(false)
    expect(isBulletUnread({})).toBe(false)
  })

  it("returns self when the bullet itself has unread generated output", () => {
    const state = createSeededOutlineState()
    state.nodes["research-products"].metadata.unread = true

    expect(getBulletUnreadState(state, "research-products")).toBe("self")
  })

  it("returns descendant only for collapsed parents of unread bullets", () => {
    const state = createSeededOutlineState()
    state.nodes.research.collapsed = true
    state.nodes["research-products"].metadata.unread = true

    expect(getBulletUnreadState(state, "research")).toBe("descendant")
    expect(getBulletUnreadState(state, "root-project")).toBe("none")
  })

  it("lets a bullet's own unread state win over hidden unread descendants", () => {
    const state = createSeededOutlineState()
    state.nodes.research.collapsed = true
    state.nodes.research.metadata.unread = true
    state.nodes["research-products"].metadata.unread = true

    expect(getBulletUnreadState(state, "research")).toBe("self")
  })
})
