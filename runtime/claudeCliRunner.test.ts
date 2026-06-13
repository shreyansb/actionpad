// @vitest-environment node
import { EventEmitter } from "node:events"
import type { ChildProcessByStdio } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { buildClaudeCliArgs, createClaudeCliRunner } from "./claudeCliRunner"

describe("buildClaudeCliArgs", () => {
  it("builds stream-json print args for a new run", () => {
    expect(
      buildClaudeCliArgs({
        model: "sonnet",
        effort: "high",
        permissionMode: "acceptEdits",
        allowedTools: ["Read", "Edit"],
        disallowedTools: ["WebFetch"],
        workspace: "/repo/actionpad",
      }),
    ).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      "/repo/actionpad",
      "--allowedTools",
      "Read,Edit",
      "--disallowedTools",
      "WebFetch",
    ])
  })

  it("adds resume when a provider thread id exists", () => {
    expect(
      buildClaudeCliArgs({
        permissionMode: "default",
        allowedTools: [],
        disallowedTools: [],
        workspace: "/repo/actionpad",
        resumeSessionId: "session-1",
      }),
    ).toEqual(expect.arrayContaining(["--resume", "session-1"]))
  })
})

describe("createClaudeCliRunner", () => {
  it("writes the prompt to stdin and yields parsed JSON lines", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable
      stdout: Readable
      stderr: Readable
      kill: ReturnType<typeof vi.fn>
    }
    const writes: string[] = []
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        writes.push(String(chunk))
        callback()
      },
    })
    child.stdout = Readable.from([
      '{"type":"system","subtype":"init","session_id":"session-1"}\n',
      '{"type":"result","subtype":"success","result":"done","session_id":"session-1"}\n',
    ])
    child.stderr = Readable.from([])
    child.kill = vi.fn()

    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("close", 0))
      return child as unknown as ChildProcessByStdio<Writable, Readable, Readable>
    })
    const runner = createClaudeCliRunner({ spawn })

    const events = []
    for await (const event of runner.run({
      executable: "claude",
      prompt: "hello",
      workspace: "/repo/actionpad",
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: [],
    })) {
      events.push(event)
    }

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--print", "--output-format", "stream-json"]),
      expect.objectContaining({ cwd: "/repo/actionpad" }),
    )
    expect(writes.join("")).toBe("hello")
    expect(events).toEqual([
      { type: "system", subtype: "init", session_id: "session-1" },
      { type: "result", subtype: "success", result: "done", session_id: "session-1" },
    ])
  })
})
