import { describe, expect, it } from "vitest"
import { createSeededOutlineState } from "./fixtures"
import { getBulletUnreadState, isThreadUnread } from "./unread"

describe("unread state", () => {
  it("marks a thread unread when activity is newer than seen time", () => {
    expect(isThreadUnread({ lastActivityAt: 20, lastSeenAt: 10 })).toBe(true)
    expect(isThreadUnread({ lastActivityAt: 20, lastSeenAt: 20 })).toBe(false)
  })

  it("returns self when the bullet's own thread is unread", () => {
    const state = createSeededOutlineState()
    state.nodes["research-products"].threadId = "thread-1"
    state.threads["thread-1"] = {
      id: "thread-1",
      provider: "codex",
      providerThreadId: null,
      nodeId: "research-products",
      messages: [],
      events: [],
      runs: [],
      lastActivityAt: 20,
      lastSeenAt: 10,
    }

    expect(getBulletUnreadState(state, "research-products")).toBe("self")
  })

  it("returns descendant for parents of unread bullets", () => {
    const state = createSeededOutlineState()
    state.nodes["research-products"].threadId = "thread-1"
    state.threads["thread-1"] = {
      id: "thread-1",
      provider: "codex",
      providerThreadId: null,
      nodeId: "research-products",
      messages: [],
      events: [],
      runs: [],
      lastActivityAt: 20,
      lastSeenAt: 10,
    }

    expect(getBulletUnreadState(state, "research")).toBe("descendant")
    expect(getBulletUnreadState(state, "root-project")).toBe("descendant")
  })

  it("lets a bullet's own unread state win over unread descendants", () => {
    const state = createSeededOutlineState()
    state.nodes.research.threadId = "parent-thread"
    state.nodes["research-products"].threadId = "child-thread"
    state.threads["parent-thread"] = {
      id: "parent-thread",
      provider: "codex",
      providerThreadId: null,
      nodeId: "research",
      messages: [],
      events: [],
      runs: [],
      lastActivityAt: 30,
      lastSeenAt: 10,
    }
    state.threads["child-thread"] = {
      id: "child-thread",
      provider: "codex",
      providerThreadId: null,
      nodeId: "research-products",
      messages: [],
      events: [],
      runs: [],
      lastActivityAt: 20,
      lastSeenAt: 10,
    }

    expect(getBulletUnreadState(state, "research")).toBe("self")
  })
})
