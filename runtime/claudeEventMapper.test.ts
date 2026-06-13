// @vitest-environment node
import { describe, expect, it } from "vitest"
import { createClaudeEventMapper } from "./claudeEventMapper"

describe("claudeEventMapper", () => {
  it("emits run-started with provider thread id from session init", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      prompt: "Prompt",
      context: "Context",
      now: () => 100,
    })

    expect(mapper.map({ type: "system", subtype: "init", session_id: "session-1" })).toEqual([
      {
        type: "run-started",
        runId: "claude-run-1",
        threadId: "claude-thread-1",
        nodeId: "node-1",
        provider: "claude",
        providerThreadId: "session-1",
        prompt: "Prompt",
        context: "Context",
        createdAt: 100,
      },
    ])
    expect(mapper.providerThreadId()).toBe("session-1")
  })

  it("maps assistant text to streaming events and keeps raw final assistant text", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    const events = mapper.map({
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      },
      session_id: "session-1",
    })

    expect(events).toContainEqual({
      type: "assistant-message-started",
      runId: "claude-run-1",
      messageId: "msg-1",
      createdAt: 100,
    })
    expect(events).toContainEqual({
      type: "assistant-delta",
      runId: "claude-run-1",
      messageId: "msg-1",
      delta: "Done.",
      createdAt: 100,
    })
    expect(events).toContainEqual({
      type: "assistant-message-completed",
      runId: "claude-run-1",
      messageId: "msg-1",
      content: "Done.",
      createdAt: 100,
    })
    expect(mapper.finalAssistantText()).toBe("Done.")
  })

  it("hides outline output blocks from assistant display text", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    const events = mapper.map({
      type: "assistant",
      message: {
        id: "msg-1",
        content: [
          {
            type: "text",
            text: 'Visible<actionpad-outline-output>{"type":"delete-bullets","nodeIds":["node-1"]}</actionpad-outline-output>',
          },
        ],
      },
    })

    expect(events).toContainEqual(expect.objectContaining({ type: "assistant-delta", delta: "Visible" }))
    expect(mapper.finalAssistantText()).toContain("<actionpad-outline-output>")
  })

  it("maps tool_use and tool_result content", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    expect(
      mapper.map({
        type: "assistant",
        message: {
          id: "msg-1",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "git status" } }],
        },
      }),
    ).toContainEqual({
      type: "tool-started",
      runId: "claude-run-1",
      toolCallId: "tool-1",
      name: "Bash",
      createdAt: 100,
    })

    expect(
      mapper.map({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "clean" }],
        },
      }),
    ).toContainEqual({
      type: "tool-completed",
      runId: "claude-run-1",
      toolCallId: "tool-1",
      name: "Bash",
      output: "clean",
      createdAt: 100,
    })
  })

  it("maps error results to run-failed", () => {
    const mapper = createClaudeEventMapper({
      runId: "claude-run-1",
      threadId: "claude-thread-1",
      nodeId: "node-1",
      now: () => 100,
    })

    expect(
      mapper.map({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        error: "Claude failed",
      }),
    ).toContainEqual({
      type: "run-failed",
      runId: "claude-run-1",
      error: "Claude failed",
      createdAt: 100,
    })
  })
})
