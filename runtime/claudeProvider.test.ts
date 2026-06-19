// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import { createClaudeProvider, type ClaudeRunnerLike } from "./claudeProvider"

const request: StartRunRequest = {
  provider: "claude",
  nodeId: "node-1",
  prompt: "Create a child bullet.",
  context: "Context",
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

function runner(events: Array<Record<string, unknown>>): ClaudeRunnerLike {
  return {
    run: vi.fn(async function* () {
      for (const event of events) yield event
    }),
  }
}

describe("claudeProvider", () => {
  it("streams Claude events and emits a validated outline patch", async () => {
    const provider = createClaudeProvider({
      runner: runner([
        { type: "system", subtype: "init", session_id: "claude-session-1" },
        {
          type: "assistant",
          session_id: "claude-session-1",
          message: {
            id: "msg-1",
            content: [
              {
                type: "text",
                text: '<actionpad-outline-output>{"type":"append-child-bullets","parentId":"node-1","bullets":[{"text":"Child."}]}</actionpad-outline-output>',
              },
            ],
          },
        },
        { type: "result", subtype: "success", session_id: "claude-session-1", is_error: false },
      ]),
      workspace: "/repo/actionpad",
      config: { executable: "claude", permissionMode: "default", allowedTools: [], disallowedTools: [] },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run-started",
        provider: "claude",
        providerThreadId: "claude-session-1",
      }),
    )
    expect(events).toContainEqual({
      type: "outline-patch",
      runId: "claude-run-100",
      patch: {
        type: "append-child-bullets",
        parentId: "node-1",
        bullets: [{ text: "Child." }],
      },
      createdAt: 100,
    })
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "run-completed" }))
  })

  it("resumes follow-up messages with providerThreadId", async () => {
    const fakeRunner = runner([
      {
        type: "assistant",
        session_id: "claude-session-1",
        message: {
          id: "msg-1",
          content: [
            {
              type: "text",
              text: '<actionpad-outline-output>{"type":"append-child-bullets","parentId":"node-1","bullets":[{"text":"Follow-up."}]}</actionpad-outline-output>',
            },
          ],
        },
      },
    ])
    const provider = createClaudeProvider({
      runner: fakeRunner,
      workspace: "/repo/actionpad",
      config: { executable: "claude", permissionMode: "default", allowedTools: [], disallowedTools: [] },
      now: () => 100,
    })

    await collect(
      provider.sendMessage({
        ...request,
        threadId: "thread-1",
        providerThreadId: "claude-session-1",
        prompt: "Follow up.",
      }),
    )

    expect(fakeRunner.run).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: "claude-session-1" }))
  })
})
