import { Codex } from "@openai/codex-sdk"
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk"
import type { AgentProvider, AgentProviderEvent, AgentThreadSnapshot } from "./provider"
import { buildActionpadPrompt } from "./actionpadPrompt"
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
  mcp?: RuntimeConfig["mcp"]
  now?: () => number
}

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexClientConfig
type CodexClientConfig = {
  [key: string]: CodexConfigValue
}

export function buildCodexClientConfig(options: CodexProviderOptions): CodexClientConfig {
  const mcp = options.mcp
  if (!mcp || mcp.enabled === false) return {}

  return {
    mcp_servers: {
      actionpad: {
        command: "npm",
        args: ["run", "mcp:start"],
        env: {
          ACTIONPAD_MCP_PROFILE: mcp.profile ?? "agent",
          ACTIONPAD_RUNTIME_URL: mcp.runtimeUrl ?? "http://127.0.0.1:43217",
        },
      },
    },
  }
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
  const codex = options.codex ?? new Codex({ config: buildCodexClientConfig(options) })
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
        yield { type: "run-completed", runId, outcome: patch.outcome ?? "succeeded", createdAt: now() }
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
        yield { type: "run-completed", runId, outcome: patch.outcome ?? "succeeded", createdAt: now() }
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
