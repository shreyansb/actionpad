import { describe, expect, it } from "vitest"
import {
  createInitialOutlineState as createEmptyOutlineState,
  createSeededOutlineState as createInitialOutlineState,
} from "../domain/fixtures"
import { outlineReducer } from "./outlineReducer"

describe("outlineReducer", () => {
  it("hydrates from a persisted outline state without adding undo history", () => {
    const state = createEmptyOutlineState()
    const persisted = {
      ...state,
      focusedNodeId: "root",
      nodes: {
        ...state.nodes,
        root: {
          ...state.nodes.root,
          text: "Persisted document",
        },
      },
      undoStack: [],
    }

    const next = outlineReducer(createEmptyOutlineState(), {
      type: "hydrate-state",
      state: persisted,
    })

    expect(next.nodes.root.text).toBe("Persisted document")
    expect(next.undoStack).toEqual([])
  })

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

  it("attaches filesystem mention metadata to a bullet", () => {
    const state = createInitialOutlineState()

    const next = outlineReducer(state, {
      type: "attach-mention",
      nodeId: "research-products",
      mention: {
        id: "mention-1",
        kind: "file",
        path: "/repo/README.md",
        label: "README.md",
        token: "@README.md",
        createdAt: 100,
      },
    })

    expect(next.nodes["research-products"].metadata.mentions).toEqual([
      {
        id: "mention-1",
        kind: "file",
        path: "/repo/README.md",
        label: "README.md",
        token: "@README.md",
        createdAt: 100,
      },
    ])
    expect(next.undoStack).toHaveLength(1)
  })

  it("checks task metadata when a runtime run completes successfully", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const completed = outlineReducer(running, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-1", outcome: "succeeded", createdAt: 105 },
      createdAt: 105,
    })

    expect(completed.nodes["research-products"].metadata.taskChecked).toBe(true)
  })

  it("lets task checkboxes be toggled manually", () => {
    const state = createInitialOutlineState()
    const checked = {
      ...state,
      nodes: {
        ...state.nodes,
        "research-products": {
          ...state.nodes["research-products"],
          metadata: { taskChecked: true },
        },
      },
    }

    const unchecked = outlineReducer(checked, {
      type: "set-task-checked",
      nodeId: "research-products",
      checked: false,
    })

    expect(unchecked.nodes["research-products"].metadata.taskChecked).toBe(false)
    expect(unchecked.undoStack).toHaveLength(1)
  })

  it("can remove a task checkbox without removing the run thread", () => {
    const state = createInitialOutlineState()
    const checked = {
      ...state,
      nodes: {
        ...state.nodes,
        "research-products": {
          ...state.nodes["research-products"],
          threadId: "thread-1",
          metadata: { taskChecked: true },
        },
      },
    }

    const withoutCheckbox = outlineReducer(checked, {
      type: "delete-task-checkbox",
      nodeId: "research-products",
    })

    expect(withoutCheckbox.nodes["research-products"].threadId).toBe("thread-1")
    expect(withoutCheckbox.nodes["research-products"].metadata.taskChecked).toBe(false)
    expect(withoutCheckbox.nodes["research-products"].metadata.taskCheckboxDeleted).toBe(true)
    expect(withoutCheckbox.undoStack).toHaveLength(1)
  })

  it("records activity and seen timestamps independently from generated-output unread state", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const completed = outlineReducer(running, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-1", createdAt: 105 },
      createdAt: 105,
    })

    expect(completed.threads["thread-1"].lastActivityAt).toBe(105)
    expect(completed.threads["thread-1"].lastSeenAt).toBeUndefined()

    const seen = outlineReducer(completed, {
      type: "select-thread",
      threadId: "thread-1",
      seenAt: 110,
    })

    expect(seen.threads["thread-1"].lastSeenAt).toBe(110)
    expect(seen.panelOpen).toBe(true)
  })

  it("records an open selected thread as seen when the run completes", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const open = {
      ...running,
      selectedThreadId: "thread-1",
      panelOpen: true,
    }
    const completed = outlineReducer(open, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-1", createdAt: 105 },
      createdAt: 105,
    })

    expect(completed.threads["thread-1"].lastActivityAt).toBe(105)
    expect(completed.threads["thread-1"].lastSeenAt).toBe(105)
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
    expect(next.undoStack[next.undoStack.length - 1]?.threads["thread-1"]).toBeDefined()
  })

  it("undo restores a deleted node and its thread", () => {
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

    const restored = outlineReducer(deleted, { type: "undo" })

    expect(restored.nodes["research-products"]).toBeDefined()
    expect(restored.nodes.research.children).toEqual(["research-products"])
    expect(restored.threads["thread-1"]).toBeDefined()
    expect(restored.selectedThreadId).toBe("thread-1")
    expect(restored.panelOpen).toBe(true)
    expect(restored.focusedNodeId).toBe("research-products")
    expect(restored.undoStack).toHaveLength(1)
  })

  it("undo walks backward through multiple document actions", () => {
    const state = createInitialOutlineState()
    const edited = outlineReducer(state, {
      type: "update-text",
      nodeId: "research-products",
      text: "Find adjacent references",
    })
    const inserted = outlineReducer(edited, {
      type: "insert-sibling-after",
      afterNodeId: "research-products",
      id: "new-note",
      text: "",
    })
    const moved = outlineReducer(inserted, {
      type: "move-node",
      nodeId: "ui-exploration",
      direction: "up",
    })

    expect(moved.undoStack).toHaveLength(3)

    const undoMove = outlineReducer(moved, { type: "undo" })
    expect(undoMove.nodes["root-project"].children).toEqual(["research", "ui-exploration"])
    expect(undoMove.nodes["research-products"].text).toBe("Find adjacent references")

    const undoInsert = outlineReducer(undoMove, { type: "undo" })
    expect(undoInsert.nodes["new-note"]).toBeUndefined()
    expect(undoInsert.nodes["research-products"].text).toBe("Find adjacent references")

    const undoText = outlineReducer(undoInsert, { type: "undo" })
    expect(undoText.nodes["research-products"].text).toBe("Find adjacent products and patterns")
    expect(undoText.undoStack).toHaveLength(0)
  })

  it("creates a thread and marks the node running", () => {
    const next = outlineReducer(createInitialOutlineState(), {
      type: "run-started",
      nodeId: "research-products",
      threadId: "thread-1",
      context: "Actionpad Prototype\nResearch\nFind adjacent products and patterns",
      createdAt: 100,
    })
    expect(next.nodes["research-products"].runStatus).toBe("running")
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.selectedThreadId).toBe("thread-1")
    expect(next.panelOpen).toBe(true)
    expect(next.threads["thread-1"].provider).toBe("codex")
    expect(next.threads["thread-1"].providerThreadId).toBeNull()
    expect(next.threads["thread-1"].runs).toEqual([])
    expect(next.threads["thread-1"].messages[0].role).toBe("user")
  })

  it("starts a runtime run and stores thread/run state", () => {
    const next = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        providerThreadId: "codex-thread-1",
        createdAt: 100,
      },
      createdAt: 100,
      context: "Actionpad Prototype\nResearch\nFind adjacent products and patterns",
    })

    expect(next.nodes["research-products"].runStatus).toBe("running")
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.nodes["research-products"].activeRunId).toBe("run-1")
    expect(next.focusedNodeId).toBe("research-products")
    expect(next.selectedThreadId).toBe("thread-1")
    expect(next.panelOpen).toBe(false)
    expect(next.threads["thread-1"].provider).toBe("codex")
    expect(next.threads["thread-1"].providerThreadId).toBe("codex-thread-1")
    expect(next.threads["thread-1"].runs).toEqual(["run-1"])
    expect(next.threads["thread-1"].messages[0]).toEqual(
      expect.objectContaining({
        id: "thread-1-user-100",
        role: "user",
        content: "Find adjacent products and patterns",
        status: "complete",
      }),
    )
    expect(next.threads["thread-1"].events).toContainEqual({
      type: "run-started",
      nodeId: "research-products",
      runId: "run-1",
      createdAt: 100,
    })
    expect(next.runs["run-1"]).toEqual(
      expect.objectContaining({
        id: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        status: "running",
        prompt: "Find adjacent products and patterns",
        context: "Actionpad Prototype\nResearch\nFind adjacent products and patterns",
        providerMetadata: {},
      }),
    )
  })

  it("ignores a second runtime run for an already-running node on a different thread", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })

    const next = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-2",
        threadId: "thread-2",
        nodeId: "research-products",
        createdAt: 110,
      },
      createdAt: 110,
      context: "new context",
    })

    expect(next).toBe(running)
    expect(next.nodes["research-products"].threadId).toBe("thread-1")
    expect(next.nodes["research-products"].activeRunId).toBe("run-1")
    expect(next.threads["thread-2"]).toBeUndefined()
    expect(next.runs["run-2"]).toBeUndefined()
  })

  it("treats duplicate runtime run-started events as idempotent for the attached run", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const closed = { ...running, panelOpen: false, selectedThreadId: null }

    const next = outlineReducer(closed, {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })

    expect(next).toBe(closed)
    expect(next.selectedThreadId).toBeNull()
    expect(next.panelOpen).toBe(false)
    expect(next.nodes["research-products"].activeRunId).toBe("run-1")
    expect(next.threads["thread-1"].messages).toHaveLength(1)
    expect(next.threads["thread-1"].events).toHaveLength(1)
    expect(next.threads["thread-1"].runs).toEqual(["run-1"])
  })

  it("appends assistant deltas, applies outline patches, and completes runtime runs", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const startedMessage = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "assistant-message-started",
        runId: "run-1",
        messageId: "message-1",
        createdAt: 101,
      },
      createdAt: 101,
    })
    const withDelta = outlineReducer(startedMessage, {
      type: "runtime-event",
      event: {
        type: "assistant-delta",
        runId: "run-1",
        messageId: "message-1",
        delta: "Working.",
        createdAt: 102,
      },
      createdAt: 102,
    })
    const completedMessage = outlineReducer(withDelta, {
      type: "runtime-event",
      event: {
        type: "assistant-message-completed",
        runId: "run-1",
        messageId: "message-1",
        createdAt: 103,
      },
      createdAt: 103,
    })
    const withPatch = outlineReducer(completedMessage, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "First generated child." }],
        },
        createdAt: 104,
      },
      createdAt: 104,
      generatedIds: ["generated-1"],
    })
    const completed = outlineReducer(withPatch, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-1", createdAt: 105 },
      createdAt: 105,
    })

    expect(completed.threads["thread-1"].messages).toContainEqual(
      expect.objectContaining({
        id: "message-1",
        role: "assistant",
        content: "Working.",
        status: "complete",
      }),
    )
    expect(completed.nodes["research-products"].children).toEqual(["generated-1"])
    expect(completed.nodes["generated-1"].metadata.generated).toBe(true)
    expect(completed.nodes["generated-1"].metadata.unread).toBe(true)
    expect(completed.threads["thread-1"].events).toContainEqual(
      expect.objectContaining({
        type: "outline-output",
        output: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "First generated child." }],
        },
        createdAt: 104,
      }),
    )
    expect(completed.nodes["research-products"].runStatus).toBe("succeeded")
    expect(completed.nodes["research-products"].activeRunId).toBeUndefined()
    expect(completed.runs["run-1"].status).toBe("succeeded")
    expect(completed.runs["run-1"].updatedAt).toBe(105)
  })

  it("marks displayed generated output viewed without adding undo history", () => {
    const state = createEmptyOutlineState()
    state.nodes.root.metadata = { generated: true, unread: true, source: "test" }

    const next = outlineReducer(state, { type: "mark-node-viewed", nodeId: "root" })

    expect(next.nodes.root.metadata).toEqual({ generated: true, source: "test" })
    expect(next.undoStack).toHaveLength(0)
  })

  it("undoes generated runtime output without restoring running runtime state", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const withPatch = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "First generated child." }],
        },
        createdAt: 104,
      },
      createdAt: 104,
      generatedIds: ["generated-1"],
    })
    const completed = outlineReducer(withPatch, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-1", createdAt: 105 },
      createdAt: 105,
    })

    const undone = outlineReducer(completed, { type: "undo" })

    expect(undone.nodes["research-products"].children).toEqual([])
    expect(undone.nodes["generated-1"]).toBeUndefined()
    expect(undone.nodes["research-products"].runStatus).toBe("succeeded")
    expect(undone.nodes["research-products"].activeRunId).toBeUndefined()
    expect(undone.nodes["research-products"].threadId).toBe("thread-1")
    expect(undone.runs["run-1"].status).toBe("succeeded")
    expect(undone.runs["run-1"].updatedAt).toBe(105)
  })

  it("ignores late assistant deltas for completed messages", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const startedMessage = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "assistant-message-started",
        runId: "run-1",
        messageId: "message-1",
        createdAt: 101,
      },
      createdAt: 101,
    })
    const completedMessage = outlineReducer(startedMessage, {
      type: "runtime-event",
      event: {
        type: "assistant-message-completed",
        runId: "run-1",
        messageId: "message-1",
        content: "Done.",
        createdAt: 102,
      },
      createdAt: 102,
    })

    const lateDelta = outlineReducer(completedMessage, {
      type: "runtime-event",
      event: {
        type: "assistant-delta",
        runId: "run-1",
        messageId: "message-1",
        delta: " Late.",
        createdAt: 103,
      },
      createdAt: 103,
    })

    expect(lateDelta).toBe(completedMessage)
    expect(lateDelta.threads["thread-1"].messages).toContainEqual(
      expect.objectContaining({
        id: "message-1",
        content: "Done.",
        status: "complete",
      }),
    )
  })

  it("ignores duplicate runtime outline patches even with fresh generated ids", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const firstPatch = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "First generated child." }],
        },
        createdAt: 104,
      },
      createdAt: 104,
      generatedIds: ["generated-1"],
    })

    const duplicatePatch = outlineReducer(firstPatch, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "First generated child." }],
        },
        createdAt: 104,
      },
      createdAt: 104,
      generatedIds: ["generated-2"],
    })

    expect(duplicatePatch).toBe(firstPatch)
    expect(duplicatePatch.nodes["research-products"].children).toEqual(["generated-1"])
    expect(duplicatePatch.nodes["generated-2"]).toBeUndefined()
    expect(
      duplicatePatch.threads["thread-1"].events.filter(
        (event) => event.type === "outline-output",
      ),
    ).toHaveLength(1)
  })

  it("stores runtime message-created events with stable generated ids", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })

    const next = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "message-created",
        runId: "run-1",
        message: { role: "assistant", content: "Done.", createdAt: 120 },
        createdAt: 120,
      },
      createdAt: 120,
    })

    expect(next.threads["thread-1"].messages).toContainEqual({
      id: "run-1-message-120-assistant",
      role: "assistant",
      content: "Done.",
      createdAt: 120,
      status: "complete",
    })
    expect(next.threads["thread-1"].events).toContainEqual({
      type: "message-created",
      messageId: "run-1-message-120-assistant",
      createdAt: 120,
    })
  })

  it("does not duplicate runtime assistant or message-created messages", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const withAssistant = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "assistant-message-started",
        runId: "run-1",
        messageId: "message-1",
        createdAt: 101,
      },
      createdAt: 101,
    })
    const duplicateAssistant = outlineReducer(withAssistant, {
      type: "runtime-event",
      event: {
        type: "assistant-message-started",
        runId: "run-1",
        messageId: "message-1",
        createdAt: 101,
      },
      createdAt: 101,
    })
    const withMessage = outlineReducer(duplicateAssistant, {
      type: "runtime-event",
      event: {
        type: "message-created",
        runId: "run-1",
        message: { role: "tool", content: "Tool output.", createdAt: 120 },
        createdAt: 120,
      },
      createdAt: 120,
    })
    const duplicateMessage = outlineReducer(withMessage, {
      type: "runtime-event",
      event: {
        type: "message-created",
        runId: "run-1",
        message: { role: "tool", content: "Tool output.", createdAt: 120 },
        createdAt: 120,
      },
      createdAt: 120,
    })

    expect(duplicateAssistant.threads["thread-1"].messages).toHaveLength(2)
    expect(
      duplicateAssistant.threads["thread-1"].messages.filter(
        (message) => message.id === "message-1",
      ),
    ).toHaveLength(1)
    expect(duplicateMessage.threads["thread-1"].messages).toHaveLength(3)
    expect(
      duplicateMessage.threads["thread-1"].messages.filter(
        (message) => message.id === "run-1-message-120-tool",
      ),
    ).toHaveLength(1)
    expect(
      duplicateMessage.threads["thread-1"].events.filter(
        (event) =>
          event.type === "message-created" &&
          event.messageId === "run-1-message-120-tool",
      ),
    ).toHaveLength(1)
  })

  it("marks runtime runs failed", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })

    const failed = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "run-failed",
        runId: "run-1",
        error: "Provider failed.",
        createdAt: 130,
      },
      createdAt: 130,
    })

    expect(failed.nodes["research-products"].runStatus).toBe("failed")
    expect(failed.nodes["research-products"].activeRunId).toBeUndefined()
    expect(failed.runs["run-1"]).toEqual(
      expect.objectContaining({
        status: "failed",
        error: "Provider failed.",
        updatedAt: 130,
      }),
    )
    expect(failed.threads["thread-1"].events).toContainEqual({
      type: "run-failed",
      nodeId: "research-products",
      runId: "run-1",
      error: "Provider failed.",
      createdAt: 130,
    })
  })

  it("ignores stale runtime node events for non-active or non-running runs", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const staleRunState = {
      ...running,
      runs: {
        ...running.runs,
        "run-2": {
          ...running.runs["run-1"],
          id: "run-2",
          status: "running" as const,
        },
      },
      threads: {
        ...running.threads,
        "thread-1": {
          ...running.threads["thread-1"],
          runs: ["run-1", "run-2"],
        },
      },
    }

    const stalePatch = outlineReducer(staleRunState, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-2",
        patch: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "Late generated child." }],
        },
        createdAt: 140,
      },
      createdAt: 140,
      generatedIds: ["late-generated"],
    })
    const staleCompleted = outlineReducer(staleRunState, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-2", createdAt: 141 },
      createdAt: 141,
    })
    const staleFailed = outlineReducer(staleRunState, {
      type: "runtime-event",
      event: {
        type: "run-failed",
        runId: "run-2",
        error: "Late failure.",
        createdAt: 142,
      },
      createdAt: 142,
    })
    const completed = outlineReducer(running, {
      type: "runtime-event",
      event: { type: "run-completed", runId: "run-1", createdAt: 150 },
      createdAt: 150,
    })
    const lateFailedAfterCompletion = outlineReducer(completed, {
      type: "runtime-event",
      event: {
        type: "run-failed",
        runId: "run-1",
        error: "Late failure.",
        createdAt: 151,
      },
      createdAt: 151,
    })

    expect(stalePatch).toBe(staleRunState)
    expect(staleCompleted).toBe(staleRunState)
    expect(staleFailed).toBe(staleRunState)
    expect(lateFailedAfterCompletion).toBe(completed)
    expect(staleRunState.nodes["research-products"].activeRunId).toBe("run-1")
    expect(staleRunState.nodes["research-products"].runStatus).toBe("running")
    expect(staleRunState.nodes["research-products"].children).toEqual([])
  })

  it("stores runtime tool and approval events on the thread timeline", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })
    const toolStarted = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "tool-started",
        runId: "run-1",
        toolCallId: "tool-1",
        name: "search",
        createdAt: 110,
      },
      createdAt: 110,
    })
    const toolCompleted = outlineReducer(toolStarted, {
      type: "runtime-event",
      event: {
        type: "tool-completed",
        runId: "run-1",
        toolCallId: "tool-1",
        name: "search",
        output: "Found sources.",
        createdAt: 120,
      },
      createdAt: 120,
    })
    const approvalRequested = outlineReducer(toolCompleted, {
      type: "runtime-event",
      event: {
        type: "approval-requested",
        runId: "run-1",
        approval: {
          id: "approval-1",
          runId: "run-1",
          title: "Allow command",
          createdAt: 130,
        },
        createdAt: 130,
      },
      createdAt: 130,
    })

    expect(
      approvalRequested.threads["thread-1"].events.some(
        (event) => event.type === "tool-started",
      ),
    ).toBe(false)
    expect(approvalRequested.threads["thread-1"].events).toContainEqual({
      type: "tool-completed",
      toolCallId: "tool-1",
      name: "search",
      runId: "run-1",
      output: "Found sources.",
      createdAt: 120,
    })
    expect(
      approvalRequested.threads["thread-1"].events.filter(
        (event) => event.type === "tool-completed",
      ),
    ).toHaveLength(1)
    expect(approvalRequested.threads["thread-1"].events).toContainEqual({
      type: "approval-requested",
      approvalId: "approval-1",
      runId: "run-1",
      createdAt: 130,
    })
  })

  it("ignores runtime outline patches without matching generated ids", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })

    const mismatched = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: {
          type: "append-child-bullets",
          parentId: "research-products",
          bullets: [{ text: "First generated child." }, { text: "Second generated child." }],
        },
        createdAt: 104,
      },
      createdAt: 104,
      generatedIds: ["generated-1"],
    })
    const updated = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: { type: "update-bullet-text", nodeId: "research-products", text: "Updated." },
        createdAt: 105,
      },
      createdAt: 105,
    })

    expect(mismatched).toBe(running)
    expect(updated.nodes["research-products"].text).toBe("Updated.")
  })

  it("applies nested append, update, and delete outline patches", () => {
    const running = outlineReducer(createInitialOutlineState(), {
      type: "runtime-event",
      event: {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        createdAt: 100,
      },
      createdAt: 100,
      context: "context",
    })

    const patched = outlineReducer(running, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: {
          type: "batch",
          patches: [
            {
              type: "append-child-bullets",
              parentId: "research-products",
              bullets: [
                {
                  text: "Parent generated child.",
                  children: [{ text: "Nested generated child." }],
                },
              ],
            },
            { type: "update-bullet-text", nodeId: "research-products", text: "Updated task." },
          ],
        },
        createdAt: 105,
      },
      createdAt: 105,
      generatedIds: ["generated-1", "generated-2"],
    })

    expect(patched.nodes["research-products"].text).toBe("Updated task.")
    expect(patched.nodes["research-products"].children).toEqual(["generated-1"])
    expect(patched.nodes["generated-1"].children).toEqual(["generated-2"])
    expect(patched.nodes["generated-2"].parentId).toBe("generated-1")

    const deleted = outlineReducer(patched, {
      type: "runtime-event",
      event: {
        type: "outline-patch",
        runId: "run-1",
        patch: { type: "delete-bullets", nodeIds: ["generated-1"] },
        createdAt: 106,
      },
      createdAt: 106,
      generatedIds: [],
    })

    expect(deleted.nodes["research-products"].children).toEqual([])
    expect(deleted.nodes["generated-1"]).toBeUndefined()
    expect(deleted.nodes["generated-2"]).toBeUndefined()
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
          provider: "codex" as const,
          providerThreadId: null,
          nodeId: "research-products",
          messages: [],
          events: [],
          runs: [],
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
