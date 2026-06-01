import { describe, expect, it } from "vitest"
import type { AgentProviderEvent } from "./provider"
import { formatRuntimeLogMessage } from "./runtimeLogger"

describe("runtime logger", () => {
  it("formats run and follow-up chat start lines", () => {
    expect(
      formatRuntimeLogMessage({
        type: "chat-start",
        kind: "run",
        provider: "codex",
        nodeId: "node-1",
        prompt: "Break this down",
      }),
    ).toBe('[runtime] chat start kind=run provider=codex nodeId=node-1 prompt="Break this down..."')

    expect(
      formatRuntimeLogMessage({
        type: "chat-start",
        kind: "follow-up",
        provider: "codex",
        nodeId: "node-1",
        threadId: "thread-1",
        prompt: "Make it shorter.",
      }),
    ).toBe(
      '[runtime] chat start kind=follow-up provider=codex nodeId=node-1 threadId=thread-1 prompt="Make it shorter...."',
    )
  })

  it("logs only the first 20 prompt characters followed by ellipses", () => {
    expect(
      formatRuntimeLogMessage({
        type: "chat-start",
        kind: "run",
        provider: "codex",
        nodeId: "node-1",
        prompt: "01234567890123456789 and more text",
      }),
    ).toBe('[runtime] chat start kind=run provider=codex nodeId=node-1 prompt="01234567890123456789..."')
  })

  it("formats provider event lines for return and turn end activity", () => {
    expect(
      formatRuntimeLogMessage({
        type: "provider-event",
        provider: "codex",
        event: {
          type: "run-started",
          runId: "run-1",
          threadId: "thread-1",
          nodeId: "node-1",
          createdAt: 1,
        },
      }),
    ).toBe(
      "[runtime] chat event run-started runId=run-1 threadId=thread-1 nodeId=node-1 provider=codex",
    )

    expect(
      formatRuntimeLogMessage({
        type: "provider-event",
        provider: "codex",
        event: {
          type: "outline-patch",
          runId: "run-1",
          patch: { type: "append-child-bullets", outcome: "succeeded", parentId: "node-1", bullets: [] },
          createdAt: 2,
        },
      }),
    ).toBe("[runtime] chat return outline-patch runId=run-1 outcome=succeeded")

    expect(
      formatRuntimeLogMessage({
        type: "provider-event",
        provider: "codex",
        event: { type: "run-completed", runId: "run-1", outcome: "succeeded", createdAt: 3 },
      }),
    ).toBe("[runtime] chat turn-end runId=run-1 outcome=succeeded")
  })

  it("formats stop and failed turn-end lines", () => {
    expect(formatRuntimeLogMessage({ type: "chat-stop", runId: "run-1" })).toBe(
      "[runtime] chat stop requested runId=run-1",
    )

    const failedEvent: AgentProviderEvent = {
      type: "run-failed",
      runId: "run-1",
      error: "Cancelled.",
      createdAt: 4,
    }
    expect(
      formatRuntimeLogMessage({
        type: "provider-event",
        provider: "codex",
        event: failedEvent,
      }),
    ).toBe('[runtime] chat turn-end runId=run-1 outcome=failed error="Cancelled."')
  })
})
