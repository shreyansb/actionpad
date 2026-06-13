import { spawn as nodeSpawn } from "node:child_process"
import type { ChildProcessByStdio } from "node:child_process"
import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"
import type { RuntimeConfig } from "./codexConfig"

export type ClaudeStreamJsonEvent = Record<string, unknown> & { type?: string }

type Spawn = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcessByStdio<Writable, Readable, Readable>

export type ClaudeCliRunOptions = RuntimeConfig["claude"] & {
  prompt: string
  workspace: string
  resumeSessionId?: string | null
  signal?: AbortSignal
}

export function buildClaudeCliArgs(
  options: Omit<ClaudeCliRunOptions, "executable" | "prompt" | "signal">,
): string[] {
  const args = ["--print", "--output-format", "stream-json", "--include-partial-messages"]
  if (options.model) args.push("--model", options.model)
  if (options.effort) args.push("--effort", options.effort)
  args.push("--permission-mode", options.permissionMode)
  args.push("--add-dir", options.workspace)
  if (options.allowedTools.length > 0) args.push("--allowedTools", options.allowedTools.join(","))
  if (options.disallowedTools.length > 0) {
    args.push("--disallowedTools", options.disallowedTools.join(","))
  }
  if (options.resumeSessionId) args.push("--resume", options.resumeSessionId)
  return args
}

export function createClaudeCliRunner(options: { spawn?: Spawn } = {}) {
  const spawn: Spawn =
    options.spawn ??
    ((command, args, spawnOptions) =>
      nodeSpawn(command, args, spawnOptions) as ChildProcessByStdio<Writable, Readable, Readable>)

  return {
    async *run(runOptions: ClaudeCliRunOptions): AsyncIterable<ClaudeStreamJsonEvent> {
      const child = spawn(runOptions.executable, buildClaudeCliArgs(runOptions), {
        cwd: runOptions.workspace,
        stdio: ["pipe", "pipe", "pipe"],
      })
      const stderrChunks: string[] = []
      const closePromise = new Promise<number | null>((resolve) => {
        child.once("close", (code) => resolve(code))
      })
      const abort = () => child.kill("SIGTERM")
      runOptions.signal?.addEventListener("abort", abort, { once: true })

      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)))
      child.stdin.end(runOptions.prompt)

      try {
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
        for await (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          yield JSON.parse(trimmed) as ClaudeStreamJsonEvent
        }

        const exitCode = await closePromise
        if (exitCode && exitCode !== 0 && !runOptions.signal?.aborted) {
          throw new Error(stderrChunks.join("").trim() || `Claude Code exited with ${exitCode}.`)
        }
      } finally {
        runOptions.signal?.removeEventListener("abort", abort)
      }
    },
  }
}
