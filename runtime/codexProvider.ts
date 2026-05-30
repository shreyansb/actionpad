import { Codex } from "@openai/codex-sdk"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider } from "./provider"
import { extractOutlinePatch } from "./outlineOutput"

function buildActionpadPrompt(input: StartRunRequest): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    "The patch must append child bullets under the executing bullet.",
    `Executing bullet id: ${input.nodeId}`,
    "Context:",
    input.context,
  ].join("\n\n")
}

export function createCodexProvider(): AgentProvider {
  const codex = new Codex()

  return {
    id: "codex",

    async *startRun(input) {
      const now = Date.now()
      const runId = `codex-run-${now}`
      const threadId = `codex-thread-${now}`
      const messageId = `codex-message-${now}`
      const thread = codex.startThread({
        workingDirectory: process.cwd(),
        skipGitRepoCheck: true,
      })

      yield {
        type: "run-started",
        runId,
        threadId,
        nodeId: input.nodeId,
        provider: "codex",
        providerThreadId: null,
        createdAt: now,
      }
      yield {
        type: "assistant-message-started",
        runId,
        messageId,
        createdAt: now + 1,
      }

      const result = await thread.run(buildActionpadPrompt(input))
      const text = result.finalResponse

      yield {
        type: "assistant-delta",
        runId,
        messageId,
        delta: text,
        createdAt: Date.now(),
      }
      yield {
        type: "assistant-message-completed",
        runId,
        messageId,
        content: text,
        createdAt: Date.now(),
      }

      const patch = extractOutlinePatch(text)
      if ("error" in patch) {
        yield { type: "run-failed", runId, error: patch.error, createdAt: Date.now() }
        return
      }

      yield { type: "outline-patch", runId, patch, createdAt: Date.now() }
      yield { type: "run-completed", runId, createdAt: Date.now() }
    },

    async *sendMessage() {
      throw new Error("Codex follow-up messages are not implemented in Phase 2.")
    },

    cancelRun() {},

    getThread() {
      return null
    },
  }
}
