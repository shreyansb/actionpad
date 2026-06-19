import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Codex } from "@openai/codex-sdk"
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk"
import type { BulletMention, SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"
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

type ProviderRequest = StartRunRequest | SendMessageRequest

const runtimeDir = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(runtimeDir, "..")

export function buildCodexClientConfig(options: CodexProviderOptions): CodexClientConfig {
  const mcp = options.mcp
  if (!mcp || mcp.enabled === false) return {}

  return {
    mcp_servers: {
      actionpad: {
        command: process.execPath,
        args: ["--import", "tsx", "runtime/mcp/stdioMain.ts"],
        cwd: sourceRoot,
        env: {
          ACTIONPAD_MCP_PROFILE: mcp.profile ?? "agent",
          ACTIONPAD_RUNTIME_URL: mcp.runtimeUrl ?? "http://127.0.0.1:43217",
        },
      },
    },
  }
}

function expandHome(input: string): string {
  if (input === "~") return homedir()
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2))
  return input
}

function normalizeCandidatePath(input: string, workspace: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.includes("\0")) return null
  const expanded = expandHome(trimmed)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspace, expanded)
}

function isWithinDirectory(path: string, parent: string): boolean {
  const offset = relative(parent, path)
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset))
}

function linkedFilesystemPaths(text: string): string[] {
  const paths: string[] = []
  const markdownLinkPattern = /\]\(<?@([^>\)\n]+)>?\)/g
  for (const match of text.matchAll(markdownLinkPattern)) {
    if (match[1]) paths.push(match[1])
  }
  return paths
}

function mentionedFolderPaths(mentions: BulletMention[] | undefined): string[] {
  return (mentions ?? [])
    .filter((mention) => mention.kind === "folder")
    .map((mention) => mention.path)
}

async function existingDirectoryPath(path: string): Promise<string | null> {
  try {
    const stats = await stat(path)
    return stats.isDirectory() ? path : null
  } catch {
    return null
  }
}

async function collectAdditionalDirectories(
  request: ProviderRequest,
  workspace: string,
): Promise<string[]> {
  const normalizedWorkspace = resolve(workspace)
  const candidates = [
    ...mentionedFolderPaths(request.mentions),
    ...linkedFilesystemPaths(request.prompt),
    ...linkedFilesystemPaths(request.context),
  ]
  const directories: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const normalized = normalizeCandidatePath(candidate, normalizedWorkspace)
    if (!normalized || dirname(normalized) === normalized) continue
    if (isWithinDirectory(normalized, normalizedWorkspace)) continue
    if (seen.has(normalized)) continue

    const directory = await existingDirectoryPath(normalized)
    if (!directory) continue

    seen.add(directory)
    directories.push(directory)
  }

  return directories
}

async function toThreadOptions(
  options: CodexProviderOptions,
  request: ProviderRequest,
): Promise<ThreadOptions> {
  const workspace = options.workspace ?? process.cwd()
  const additionalDirectories = await collectAdditionalDirectories(request, workspace)

  return {
    workingDirectory: workspace,
    skipGitRepoCheck: true,
    model: options.config?.model,
    sandboxMode: options.config?.sandbox,
    approvalPolicy: options.config?.approval,
    modelReasoningEffort: options.config?.reasoning,
    networkAccessEnabled: options.config?.network,
    webSearchMode: options.config?.webSearch,
    ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
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
        const thread = codex.startThread(await toThreadOptions(options, input))
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
        yield* mapper.map({ type: "error", message })
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
          ? codex.resumeThread(providerThreadId, await toThreadOptions(options, input))
          : codex.startThread(await toThreadOptions(options, input))
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
        yield* mapper.map({ type: "error", message })
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
