import type { SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"
import { buildActionpadPrompt } from "./actionpadPrompt"
import { createClaudeCliRunner } from "./claudeCliRunner"
import type { ClaudeStreamJsonEvent } from "./claudeCliRunner"
import { createClaudeEventMapper } from "./claudeEventMapper"
import type { RuntimeConfig } from "./codexConfig"
import { extractOutlinePatch } from "./outlineOutput"
import type { AgentProvider, AgentProviderEvent, AgentThreadSnapshot } from "./provider"

export type ClaudeRunnerLike = {
  run(options: {
    executable: string
    prompt: string
    workspace: string
    model?: string
    effort?: RuntimeConfig["claude"]["effort"]
    permissionMode: RuntimeConfig["claude"]["permissionMode"]
    allowedTools: string[]
    disallowedTools: string[]
    resumeSessionId?: string | null
    signal?: AbortSignal
  }): AsyncIterable<ClaudeStreamJsonEvent>
}

type ClaudeProviderOptions = {
  runner?: ClaudeRunnerLike
  workspace?: string
  config: RuntimeConfig["claude"]
  now?: () => number
}

export function createClaudeProvider(options: ClaudeProviderOptions): AgentProvider {
  const runner = options.runner ?? createClaudeCliRunner()
  const now = options.now ?? Date.now
  const activeControllers = new Map<string, AbortController>()
  const threads = new Map<string, AgentThreadSnapshot>()

  async function* runClaude(
    input: StartRunRequest | SendMessageRequest,
    mode: "initial" | "follow-up",
    ids: { runId: string; threadId: string; providerThreadId?: string | null },
  ): AsyncIterable<AgentProviderEvent> {
    const controller = new AbortController()
    const mapper = createClaudeEventMapper({
      runId: ids.runId,
      threadId: ids.threadId,
      nodeId: input.nodeId,
      providerThreadId: ids.providerThreadId,
      prompt: input.prompt,
      context: input.context,
      now,
    })
    let failed = false
    activeControllers.set(ids.runId, controller)

    try {
      for await (const event of runner.run({
        ...options.config,
        prompt: buildActionpadPrompt(input, mode),
        workspace: options.workspace ?? process.cwd(),
        resumeSessionId: ids.providerThreadId,
        signal: controller.signal,
      })) {
        for (const mapped of mapper.map(event)) {
          if (mapped.type === "run-failed") failed = true
          yield mapped
        }
      }

      const providerThreadId = mapper.providerThreadId() ?? ids.providerThreadId ?? null
      threads.set(ids.threadId, {
        id: ids.threadId,
        provider: "claude",
        providerThreadId,
        nodeId: input.nodeId,
        messages: [],
        runs: [ids.runId],
        providerMetadata: {},
      })

      if (failed) return

      const patch = extractOutlinePatch(mapper.finalAssistantText())
      if ("error" in patch) {
        yield { type: "run-failed", runId: ids.runId, error: patch.error, createdAt: now() }
        return
      }

      yield { type: "outline-patch", runId: ids.runId, patch, createdAt: now() }
      yield { type: "run-completed", runId: ids.runId, outcome: patch.outcome ?? "succeeded", createdAt: now() }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Claude Code runtime failed."
      yield { type: "run-failed", runId: ids.runId, error: message, createdAt: now() }
    } finally {
      activeControllers.delete(ids.runId)
    }
  }

  return {
    id: "claude",

    startRun(input) {
      const startedAt = now()
      return runClaude(input, "initial", {
        runId: `claude-run-${startedAt}`,
        threadId: `claude-thread-${startedAt}`,
      })
    },

    sendMessage(input) {
      const startedAt = now()
      const providerThreadId =
        input.providerThreadId ?? threads.get(input.threadId)?.providerThreadId ?? null
      return runClaude(input, "follow-up", {
        runId: `claude-run-${startedAt}`,
        threadId: input.threadId,
        providerThreadId,
      })
    },

    cancelRun(runId) {
      activeControllers.get(runId)?.abort()
    },

    getThread(threadId) {
      return threads.get(threadId) ?? null
    },
  }
}
