import { Codex } from "@openai/codex-sdk"
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider, AgentProviderEvent, AgentThreadSnapshot } from "./provider"
import { createCodexEventMapper } from "./codexEventMapper"
import type { RuntimeConfig } from "./codexConfig"
import { extractOutlinePatch } from "./outlineOutput"

type CodexThreadLike = {
  id: string | null
  runStreamed(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>
}

export type CodexClientLike = {
  startThread(options?: ThreadOptions): CodexThreadLike
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike
}

type CodexProviderOptions = {
  codex?: CodexClientLike
  workspace?: string
  config?: Partial<RuntimeConfig["codex"]>
  now?: () => number
}

function buildActionpadPrompt(input: StartRunRequest): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    "The patch must append child bullets under the executing bullet.",
    `Executing bullet id: ${input.nodeId}`,
    `Executing bullet text: ${input.prompt}`,
    "Context:",
    input.context,
  ].join("\n\n")
}

function toThreadOptions(options: CodexProviderOptions): ThreadOptions {
  return {
    workingDirectory: options.workspace ?? process.cwd(),
    skipGitRepoCheck: true,
    model: options.config?.model,
    sandboxMode: options.config?.sandbox,
    approvalPolicy: options.config?.approval,
    modelReasoningEffort: options.config?.reasoning,
    networkAccessEnabled: options.config?.network,
    webSearchMode: options.config?.webSearch,
  }
}

export function createCodexProvider(options: CodexProviderOptions = {}): AgentProvider {
  const codex = options.codex ?? new Codex()
  const now = options.now ?? Date.now
  const activeControllers = new Map<string, AbortController>()
  const threads = new Map<string, AgentThreadSnapshot>()

  return {
    id: "codex",

    async *startRun(input): AsyncIterable<AgentProviderEvent> {
      const startedAt = now()
      const runId = `codex-run-${startedAt}`
      const threadId = `codex-thread-${startedAt}`
      const controller = new AbortController()
      const mapper = createCodexEventMapper({
        runId,
        threadId,
        nodeId: input.nodeId,
        startedAt,
        now,
      })
      let failed = false
      activeControllers.set(runId, controller)

      try {
        const thread = codex.startThread(toThreadOptions(options))
        const streamed = await thread.runStreamed(buildActionpadPrompt(input), {
          signal: controller.signal,
        })

        for await (const event of streamed.events) {
          for (const mapped of mapper.map(event)) {
            if (mapped.type === "run-failed") failed = true
            yield mapped
          }
        }

        const providerThreadId = mapper.providerThreadId() ?? thread.id
        threads.set(threadId, {
          id: threadId,
          provider: "codex",
          providerThreadId,
          nodeId: input.nodeId,
          messages: [],
          runs: [runId],
          providerMetadata: {},
        })

        if (failed) return

        const patch = extractOutlinePatch(mapper.finalAssistantText(), {
          expectedParentId: input.nodeId,
        })
        if ("error" in patch) {
          yield { type: "run-failed", runId, error: patch.error, createdAt: now() }
          return
        }

        yield { type: "outline-patch", runId, patch, createdAt: now() }
        yield { type: "run-completed", runId, createdAt: now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Codex runtime failed."
        yield { type: "run-failed", runId, error: message, createdAt: now() }
      } finally {
        activeControllers.delete(runId)
      }
    },

    async *sendMessage() {
      throw new Error("Codex follow-up messages are not implemented in Phase 2.")
    },

    cancelRun(runId) {
      activeControllers.get(runId)?.abort()
    },

    getThread(threadId) {
      return threads.get(threadId) ?? null
    },
  }
}
