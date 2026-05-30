import { describe, expect, it } from "vitest"
import { createInitialOutlineState } from "../domain/fixtures"
import { outlineReducer } from "./outlineReducer"

describe("outlineReducer", () => {
  it("focuses a node", () => {
    const next = outlineReducer(createInitialOutlineState(), {
      type: "focus-node",
      nodeId: "ui-exploration",
    })
    expect(next.focusedNodeId).toBe("ui-exploration")
  })

  it("opens and closes the side panel", () => {
    const opened = outlineReducer(createInitialOutlineState(), { type: "open-panel" })
    expect(opened.panelOpen).toBe(true)
    const closed = outlineReducer(opened, { type: "close-panel" })
    expect(closed.panelOpen).toBe(false)
  })

  it("increments chat focus requests", () => {
    const state = createInitialOutlineState()
    const next = outlineReducer(state, { type: "request-chat-focus" })

    expect(next.chatFocusRequest).toBe(state.chatFocusRequest + 1)
  })

  it("deletes a node and clears its selected thread", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })

    const next = outlineReducer(running, {
      type: "delete-node",
      nodeId: "research-products",
      focusNodeId: "research",
    })

    expect(next.nodes["research-products"]).toBeUndefined()
    expect(next.nodes.research.children).toEqual([])
    expect(next.threads["thread-1"]).toBeUndefined()
    expect(next.selectedThreadId).toBeNull()
    expect(next.panelOpen).toBe(false)
    expect(next.focusedNodeId).toBe("research")
    expect(next.lastDeletedNode?.threads["thread-1"]).toBeDefined()
  })

  it("restores the last deleted node and its thread", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const deleted = outlineReducer(running, {
      type: "delete-node",
      nodeId: "research-products",
      focusNodeId: "research",
    })

    const restored = outlineReducer(deleted, { type: "restore-deleted-node" })

    expect(restored.nodes["research-products"]).toBeDefined()
    expect(restored.nodes.research.children).toEqual(["research-products"])
    expect(restored.threads["thread-1"]).toBeDefined()
    expect(restored.selectedThreadId).toBe("thread-1")
    expect(restored.panelOpen).toBe(true)
    expect(restored.focusedNodeId).toBe("research-products")
    expect(restored.lastDeletedNode).toBeNull()
  })

  it("creates a thread and marks the node running", () => {
    const next = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "Executable Outliner Prototype\nResearch\nFind adjacent products and patterns",
      createdAt: 100,
    })
    expect(next.nodes["research-products"].runStatus).toBe("running")
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.selectedThreadId).toBe("thread-1")
    expect(next.panelOpen).toBe(true)
    expect(next.threads["thread-1"].messages[0].role).toBe("user")
  })

  it("does not start a run for a missing node", () => {
    const state = createInitialOutlineState()
    const next = outlineReducer(state, {
      type: "run-started",
      nodeId: "missing-node",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    expect(next).toBe(state)
    expect(next.threads["thread-1"]).toBeUndefined()
  })

  it("does not reuse an existing thread for a different node", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const next = outlineReducer(running, {
      type: "run-started",
      nodeId: "ui-exploration",
      threadId: "thread-1",
      context: "context",
      createdAt: 200,
    })
    expect(next).toBe(running)
  })

  it("does not start a second run for the same node with a new thread", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })

    const next = outlineReducer(running, {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-2",
      context: "new context",
      createdAt: 200,
    })

    expect(next).toBe(running)
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.threads["thread-2"]).toBeUndefined()
  })

  it("opens and selects an existing attached thread for the same node", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const closed = { ...running, panelOpen: false, selectedThreadId: null }

    const next = outlineReducer(closed, {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 200,
    })

    expect(next).not.toBe(closed)
    expect(next.selectedThreadId).toBe("thread-1")
    expect(next.panelOpen).toBe(true)
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.threads["thread-1"].events).toHaveLength(1)
  })

  it("applies simulated output and marks run succeeded", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const done = outlineReducer(running, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })
    const lastMessage = done.threads["thread-1"].messages[done.threads["thread-1"].messages.length - 1]
    expect(done.nodes["research-products"].runStatus).toBe("succeeded")
    expect(done.nodes["research-products"].children).toEqual(["generated-1"])
    expect(lastMessage?.content).toBe("Done.")
    expect(done.threads["thread-1"].events.some((event) => event.type === "outline-output")).toBe(
      true,
    )
  })

  it("ignores empty completion payloads without appending events", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })

    const next = outlineReducer(running, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [],
      createdAt: 200,
    })

    expect(next).toBe(running)
    expect(next.nodes["research-products"].runStatus).toBe("running")
    expect(next.threads["thread-1"].messages).toHaveLength(1)
    expect(next.threads["thread-1"].messages.some((message) => message.role === "assistant")).toBe(
      false,
    )
    expect(next.threads["thread-1"].events).toEqual([
      { type: "run-started", nodeId: "research-products", createdAt: 100 },
    ])
    expect(next.threads["thread-1"].events.some((event) => event.type === "outline-output")).toBe(
      false,
    )
    expect(next.threads["thread-1"].events.some((event) => event.type === "run-completed")).toBe(
      false,
    )
  })

  it("does not complete a run when the thread is missing", () => {
    const state = createInitialOutlineState()
    const next = outlineReducer(state, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "missing-thread",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })
    expect(next).toBe(state)
  })

  it("does not complete a run when the node is missing", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const next = outlineReducer(running, {
      type: "run-completed",
      nodeId: "missing-node",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })
    expect(next).toBe(running)
  })

  it("does not complete a run when the thread belongs to a different node", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const next = outlineReducer(running, {
      type: "run-completed",
      nodeId: "ui-exploration",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })
    expect(next).toBe(running)
  })

  it("does not complete a run when the node is associated with a different thread", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const stateWithSecondThread = {
      ...running,
      threads: {
        ...running.threads,
        "thread-2": {
          id: "thread-2",
          nodeId: "research-products",
          messages: [],
          events: [],
        },
      },
    }
    const next = outlineReducer(stateWithSecondThread, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-2",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })
    expect(next).toBe(stateWithSecondThread)
  })

  it("does not complete a run when generated bullet ids are duplicated", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const next = outlineReducer(running, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [{ id: "ui-exploration", text: "Generated note." }],
      createdAt: 200,
    })
    expect(next).toBe(running)
    expect(next.nodes["research-products"].runStatus).toBe("running")
    expect(next.threads["thread-1"].events.some((event) => event.type === "outline-output")).toBe(
      false,
    )
  })

  it("ignores stale completions after a run has already succeeded", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "context",
      createdAt: 100,
    })
    const succeeded = outlineReducer(running, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-1",
      assistantMessage: "Done.",
      bullets: [{ id: "generated-1", text: "Generated note." }],
      createdAt: 200,
    })

    const stale = outlineReducer(succeeded, {
      type: "run-completed",
      nodeId: "research-products",
      threadId: "thread-1",
      assistantMessage: "Late result.",
      bullets: [{ id: "generated-2", text: "Late generated note." }],
      createdAt: 300,
    })

    expect(stale).toBe(succeeded)
    expect(stale.nodes["research-products"].children).toEqual(["generated-1"])
    expect(stale.threads["thread-1"].messages).toHaveLength(2)
    expect(stale.threads["thread-1"].events).toHaveLength(3)
  })
})
