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
})
