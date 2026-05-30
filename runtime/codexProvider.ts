import { Codex } from "@openai/codex-sdk"
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk"
import type { SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"
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

function buildActionpadPrompt(input: StartRunRequest | SendMessageRequest, mode: "initial" | "follow-up"): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise and useful.",
    "When adding bullets, add only a few top-level bullets. Prefer sub-bullets for supporting detail instead of long flat lists.",
    "If the user asks for changes to previous output, edit or delete the relevant bullets instead of only appending new ones.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    "Supported patch shapes:",
    '{ "type": "append-child-bullets", "parentId": "bullet-id", "bullets": [{ "text": "Short bullet", "children": [{ "text": "Optional sub-bullet" }] }] }',
    '{ "type": "update-bullet-text", "nodeId": "bullet-id", "text": "Replacement text" }',
    '{ "type": "delete-bullets", "nodeIds": ["bullet-id"] }',
    '{ "type": "batch", "patches": [{ "type": "update-bullet-text", "nodeId": "bullet-id", "text": "Replacement text" }] }',
    mode === "initial"
      ? "For a new execution, usually append child bullets under the executing bullet."
      : "For a follow-up, modify the existing outline as requested using the current outline ids.",
    `Executing bullet id: ${input.nodeId}`,
    `Executing bullet text: ${input.prompt}`,
    "Current outline snapshot:",
    JSON.stringify(input.outline, null, 2),
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
        prompt: input.prompt,
        context: input.context,
      })
      let failed = false
      activeControllers.set(runId, controller)

      try {
        const thread = codex.startThread(toThreadOptions(options))
        const streamed = await thread.runStreamed(buildActionpadPrompt(input, "initial"), {
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

        const patch = extractOutlinePatch(mapper.finalAssistantText())
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

    async *sendMessage(input): AsyncIterable<AgentProviderEvent> {
      const startedAt = now()
      const runId = `codex-run-${startedAt}`
      const controller = new AbortController()
      const providerThreadId =
        input.providerThreadId ?? threads.get(input.threadId)?.providerThreadId ?? null
      const mapper = createCodexEventMapper({
        runId,
        threadId: input.threadId,
        nodeId: input.nodeId,
        startedAt,
        now,
        providerThreadId,
        prompt: input.prompt,
        context: input.context,
      })
      let failed = false
      activeControllers.set(runId, controller)

      try {
        const thread = providerThreadId
          ? codex.resumeThread(providerThreadId, toThreadOptions(options))
          : codex.startThread(toThreadOptions(options))
        const streamed = await thread.runStreamed(buildActionpadPrompt(input, "follow-up"), {
          signal: controller.signal,
        })

        for await (const event of streamed.events) {
          for (const mapped of mapper.map(event)) {
            if (mapped.type === "run-failed") failed = true
            yield mapped
          }
        }

        const nextProviderThreadId = mapper.providerThreadId() ?? thread.id ?? providerThreadId
        threads.set(input.threadId, {
          id: input.threadId,
          provider: "codex",
          providerThreadId: nextProviderThreadId,
          nodeId: input.nodeId,
          messages: [],
          runs: [runId],
          providerMetadata: {},
        })

        if (failed) return

        const patch = extractOutlinePatch(mapper.finalAssistantText())
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

    cancelRun(runId) {
      activeControllers.get(runId)?.abort()
    },

    getThread(threadId) {
      return threads.get(threadId) ?? null
    },
  }
}
