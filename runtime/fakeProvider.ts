import type { AgentProvider, AgentProviderEvent } from "./provider"

const createdAt = 1_700_000_000_000

export function createFakeProvider(): AgentProvider {
  return {
    id: "codex",

    async *startRun(request) {
      const runId = `fake-run-${request.nodeId}`
      const threadId = `fake-thread-${request.nodeId}`
      const messageId = `fake-message-${request.nodeId}`
      const events: AgentProviderEvent[] = [
        {
          type: "run-started",
          runId,
          threadId,
          nodeId: request.nodeId,
          prompt: request.prompt,
          context: request.context,
          createdAt,
        },
        {
          type: "assistant-message-started",
          runId,
          messageId,
          createdAt: createdAt + 1,
        },
        {
          type: "assistant-delta",
          runId,
          messageId,
          delta: "I drafted three outline bullets.",
          createdAt: createdAt + 2,
        },
        {
          type: "assistant-message-completed",
          runId,
          messageId,
          createdAt: createdAt + 3,
        },
        {
          type: "outline-patch",
          runId,
          patch: {
            type: "append-child-bullets",
            parentId: request.nodeId,
            bullets: [
              {
                text: "Clarify the next action.",
                children: [{ text: "Keep the output short enough to scan." }],
              },
              { text: "Identify the smallest useful test." },
            ],
          },
          createdAt: createdAt + 4,
        },
        {
          type: "run-completed",
          runId,
          createdAt: createdAt + 5,
        },
      ]

      for (const event of events) {
        yield event
      }
    },

    async *sendMessage(request) {
      const runId = `fake-follow-up-${request.nodeId}`
      const messageId = `fake-follow-up-message-${request.nodeId}`
      const events: AgentProviderEvent[] = [
        {
          type: "run-started",
          runId,
          threadId: request.threadId,
          nodeId: request.nodeId,
          prompt: request.prompt,
          context: request.context,
          createdAt,
        },
        {
          type: "assistant-message-started",
          runId,
          messageId,
          createdAt: createdAt + 1,
        },
        {
          type: "assistant-delta",
          runId,
          messageId,
          delta: "I updated the outline from your follow-up.",
          createdAt: createdAt + 2,
        },
        {
          type: "assistant-message-completed",
          runId,
          messageId,
          createdAt: createdAt + 3,
        },
        {
          type: "outline-patch",
          runId,
          patch: {
            type: "append-child-bullets",
            parentId: request.nodeId,
            bullets: [{ text: `Follow-up: ${request.prompt}` }],
          },
          createdAt: createdAt + 4,
        },
        {
          type: "run-completed",
          runId,
          createdAt: createdAt + 5,
        },
      ]

      for (const event of events) {
        yield event
      }
    },

    cancelRun() {},

    getThread() {
      return null
    },
  }
}
