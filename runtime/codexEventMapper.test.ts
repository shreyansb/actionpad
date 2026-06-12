// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { ThreadEvent } from "@openai/codex-sdk"
import { createCodexEventMapper } from "./codexEventMapper"

describe("codexEventMapper", () => {
  it("maps thread start and assistant messages", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    const started = mapper.map({
      type: "thread.started",
      thread_id: "codex-thread-1",
    } satisfies ThreadEvent)
    const messageStarted = mapper.map({
      type: "item.started",
      item: { id: "msg-1", type: "agent_message", text: "" },
    } satisfies ThreadEvent)
    const messageCompleted = mapper.map({
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "Final answer." },
    } satisfies ThreadEvent)

    expect(started).toEqual([
      {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        providerThreadId: "codex-thread-1",
        createdAt: 100,
      },
    ])
    expect(messageStarted).toEqual([
      { type: "assistant-message-started", runId: "run-1", messageId: "msg-1", createdAt: 100 },
    ])
    expect(messageCompleted).toEqual([
      {
        type: "assistant-delta",
        runId: "run-1",
        messageId: "msg-1",
        delta: "Final answer.",
        createdAt: 100,
      },
      {
        type: "assistant-message-completed",
        runId: "run-1",
        messageId: "msg-1",
        content: "Final answer.",
        createdAt: 100,
      },
    ])
    expect(mapper.finalAssistantText()).toBe("Final answer.")
    expect(mapper.providerThreadId()).toBe("codex-thread-1")
  })

  it("maps command execution and file changes into tool timeline events", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    expect(
      mapper.map({
        type: "item.started",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "npm test",
          aggregated_output: "",
          status: "in_progress",
        },
      } satisfies ThreadEvent),
    ).toEqual([
      {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        providerThreadId: null,
        createdAt: 100,
      },
      {
        type: "tool-started",
        runId: "run-1",
        toolCallId: "cmd-1",
        name: "npm test",
        createdAt: 100,
      },
    ])

    expect(
      mapper.map({
        type: "item.completed",
        item: {
          id: "file-1",
          type: "file_change",
          changes: [{ path: "src/App.tsx", kind: "update" }],
          status: "completed",
        },
      } satisfies ThreadEvent),
    ).toEqual([
      {
        type: "tool-completed",
        runId: "run-1",
        toolCallId: "file-1",
        name: "File changes",
        output: "update src/App.tsx",
        createdAt: 100,
      },
    ])
  })

  it("maps turn failures into run-failed", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    expect(
      mapper.map({
        type: "turn.failed",
        error: { message: "Codex auth failed." },
      } satisfies ThreadEvent),
    ).toEqual([
      {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        providerThreadId: null,
        createdAt: 100,
      },
      { type: "run-failed", runId: "run-1", error: "Codex auth failed.", createdAt: 100 },
    ])
  })

  it("returns iterable events for unknown Codex event and item types", () => {
    const mapper = createCodexEventMapper({
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "research-products",
      startedAt: 100,
    })

    expect(mapper.map({ type: "session.updated" } as unknown as ThreadEvent)).toEqual([
      {
        type: "run-started",
        runId: "run-1",
        threadId: "thread-1",
        nodeId: "research-products",
        provider: "codex",
        providerThreadId: null,
        createdAt: 100,
      },
    ])
    expect(
      mapper.map({
        type: "item.completed",
        item: { id: "item-1", type: "plan_update" },
      } as unknown as ThreadEvent),
    ).toEqual([])
  })
})
