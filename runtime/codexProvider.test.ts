// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { ThreadEvent } from "@openai/codex-sdk"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import {
  buildCodexClientConfig,
  createCodexProvider,
  type CodexClientLike,
} from "./codexProvider"

const request: StartRunRequest = {
  provider: "codex",
  nodeId: "research-products",
  prompt: "Create two child bullets.",
  context: "Actionpad Prototype\nResearch\nCreate two child bullets.",
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

function toEventStream(events: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  return (async function* stream() {
    for (const event of events) yield event
  })()
}

function fakeCodex(events: ThreadEvent[]): CodexClientLike {
  return {
    startThread: vi.fn(() => ({
      id: null,
      runStreamed: vi.fn(async () => ({
        events: toEventStream(events),
      })),
    })),
    resumeThread: vi.fn(),
  }
}

describe("codexProvider", () => {
  it("builds Codex MCP server config for Actionpad", () => {
    expect(
      buildCodexClientConfig({
        mcp: {
          enabled: true,
          profile: "admin",
          runtimeUrl: "http://127.0.0.1:65432",
        },
      }),
    ).toEqual({
      mcp_servers: {
        actionpad: {
          command: process.execPath,
          args: ["--import", "tsx", "runtime/mcp/stdioMain.ts"],
          cwd: process.cwd(),
          env: {
            ACTIONPAD_MCP_PROFILE: "admin",
            ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:65432",
          },
        },
      },
    })
  })

  it("does not override Codex config when MCP is disabled", () => {
    expect(
      buildCodexClientConfig({
        mcp: {
          enabled: false,
          profile: "agent",
          runtimeUrl: "http://127.0.0.1:43217",
        },
      }),
    ).toEqual({})
    expect(buildCodexClientConfig({})).toEqual({})
  })

  it("uses stdio spawn overrides for the actionpad MCP server", () => {
    const config = buildCodexClientConfig({
      mcp: {
        enabled: true,
        profile: "agent",
        runtimeUrl: "http://127.0.0.1:5111",
        stdioCommand: "/opt/actionpad-runtime",
        stdioArgs: ["--mcp-stdio"],
        stdioCwd: "/tmp/work",
      },
    })
    const server = (config.mcp_servers as Record<string, any>).actionpad
    expect(server.command).toBe("/opt/actionpad-runtime")
    expect(server.args).toEqual(["--mcp-stdio"])
    expect(server.cwd).toBe("/tmp/work")
  })

  it("falls back to the tsx invocation when no overrides are set", () => {
    const config = buildCodexClientConfig({
      mcp: { enabled: true, profile: "agent", runtimeUrl: "http://127.0.0.1:5111" },
    })
    const server = (config.mcp_servers as Record<string, any>).actionpad
    expect(server.args).toEqual(["--import", "tsx", "runtime/mcp/stdioMain.ts"])
  })

  it("sends only ancestor context instead of the full outline snapshot", async () => {
    const runStreamed = vi.fn(async () => ({
      events: toEventStream([
        { type: "thread.started", thread_id: "codex-thread-1" },
        {
          type: "item.completed",
          item: {
            id: "msg-1",
            type: "agent_message",
            text: `<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "Child." }] }
</actionpad-outline-output>`,
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      ]),
    }))
    const provider = createCodexProvider({
      codex: {
        startThread: vi.fn(() => ({ id: null, runStreamed })),
        resumeThread: vi.fn(),
      },
      now: () => 100,
    })

    await collect(
      provider.startRun({
        ...request,
        context: "Actionpad\nBugs\nRemove the outline snapshot.",
      }),
    )

    expect(runStreamed).toHaveBeenCalled()
    const [[prompt]] = runStreamed.mock.calls as unknown as Array<[string]>

    expect(prompt).toContain("Ancestor bullets:")
    expect(prompt).toContain("Actionpad\nBugs\nRemove the outline snapshot.")
    expect(prompt).not.toContain("Current outline snapshot")
  })

  it("passes linked project folders from outline context as additional Codex directories", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "actionpad-workspace-"))
    const linkedProject = await mkdtemp(join(tmpdir(), "actionpad-linked-project-"))
    try {
      const startThread = vi.fn(() => ({
        id: null,
        runStreamed: vi.fn(async () => ({
          events: toEventStream([
            { type: "thread.started", thread_id: "codex-thread-1" },
            {
              type: "item.completed",
              item: {
                id: "msg-1",
                type: "agent_message",
                text: `<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "Child." }] }
</actionpad-outline-output>`,
              },
            },
            {
              type: "turn.completed",
              usage: {
                input_tokens: 1,
                cached_input_tokens: 0,
                output_tokens: 1,
                reasoning_output_tokens: 0,
              },
            },
          ]),
        })),
      }))
      const provider = createCodexProvider({
        codex: {
          startThread,
          resumeThread: vi.fn(),
        },
        workspace,
        config: {
          sandbox: "workspace-write",
          approval: "on-request",
          network: false,
          webSearch: "disabled",
        },
        now: () => 100,
      })

      await collect(
        provider.startRun({
          ...request,
          context: `projects\n[site](<@${linkedProject}>)\napp`,
        }),
      )

      expect(startThread).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: workspace,
          additionalDirectories: [linkedProject],
        }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(linkedProject, { recursive: true, force: true })
    }
  })

  it("streams Codex events and emits a validated outline patch", async () => {
    const finalText = `Done.
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "First child." }] }
</actionpad-outline-output>`
    const provider = createCodexProvider({
      codex: fakeCodex([
        { type: "thread.started", thread_id: "codex-thread-1" },
        { type: "item.started", item: { id: "msg-1", type: "agent_message", text: "" } },
        { type: "item.completed", item: { id: "msg-1", type: "agent_message", text: finalText } },
        {
          type: "item.completed",
          item: {
            id: "file-1",
            type: "file_change",
            changes: [{ path: "README.md", kind: "update" }],
            status: "completed",
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      ]),
      workspace: "/repo/actionpad",
      config: {
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run-started",
        providerThreadId: "codex-thread-1",
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-completed",
        name: "File changes",
        output: "update README.md",
      }),
    )
    expect(events).toContainEqual({
      type: "outline-patch",
      runId: expect.any(String),
      patch: {
        type: "append-child-bullets",
        parentId: "research-products",
        bullets: [{ text: "First child." }],
      },
      createdAt: 100,
    })
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "run-completed", createdAt: 100 }),
    )
  })

  it("emits run-started before run-failed when Codex fails before streaming any event", async () => {
    const provider = createCodexProvider({
      codex: {
        startThread: vi.fn(() => ({
          id: null,
          runStreamed: vi.fn(async () => {
            throw new Error("Codex spawn failed.")
          }),
        })),
        resumeThread: vi.fn(),
      },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events.map((event) => event.type)).toEqual(["run-started", "run-failed"])
    expect(events[0]).toEqual(
      expect.objectContaining({ type: "run-started", nodeId: "research-products" }),
    )
    expect(events[1]).toEqual(
      expect.objectContaining({ type: "run-failed", error: "Codex spawn failed." }),
    )
  })

  it("emits run-started before run-failed when the event stream throws immediately", async () => {
    const provider = createCodexProvider({
      codex: {
        startThread: vi.fn(() => ({
          id: null,
          runStreamed: vi.fn(async () => ({
            events: (async function* stream(): AsyncGenerator<ThreadEvent> {
              throw new Error("Stream collapsed.")
            })(),
          })),
        })),
        resumeThread: vi.fn(),
      },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events.map((event) => event.type)).toEqual(["run-started", "run-failed"])
    expect(events[1]).toEqual(
      expect.objectContaining({ type: "run-failed", error: "Stream collapsed." }),
    )
  })

  it("emits run-started before run-failed for follow-up messages that fail early", async () => {
    const provider = createCodexProvider({
      codex: {
        startThread: vi.fn(() => ({
          id: null,
          runStreamed: vi.fn(async () => {
            throw new Error("Codex spawn failed.")
          }),
        })),
        resumeThread: vi.fn(),
      },
      now: () => 100,
    })

    const events = await collect(
      provider.sendMessage({
        ...request,
        threadId: "thread-1",
        providerThreadId: null,
      }),
    )

    expect(events.map((event) => event.type)).toEqual(["run-started", "run-failed"])
  })

  it("emits run-failed when outline output is missing", async () => {
    const provider = createCodexProvider({
      codex: fakeCodex([
        { type: "thread.started", thread_id: "codex-thread-1" },
        {
          type: "item.completed",
          item: {
            id: "msg-1",
            type: "agent_message",
            text: "No outline patch here.",
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      ]),
      workspace: "/repo/actionpad",
      config: {
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
      now: () => 100,
    })

    const events = await collect(provider.startRun(request))

    expect(events).toContainEqual({
      type: "run-failed",
      runId: expect.any(String),
      error: "No Actionpad outline output block found.",
      createdAt: 100,
    })
    expect(events.some((event) => event.type === "run-completed")).toBe(false)
  })
})
