import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import type { AgentRuntimeEvent, StartRunRequest } from "../src/domain/runtimeProtocol"
import { createFakeProvider } from "./fakeProvider"
import { startRuntimeServer, type RuntimeServerHandle } from "./server"

let handle: RuntimeServerHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

function makeRunRequest(overrides: Partial<StartRunRequest> = {}): StartRunRequest {
  return {
    provider: "codex",
    nodeId: "node-1",
    prompt: "Break this down",
    context: "Project\nFocused bullet",
    outline: {
      rootIds: ["node-1"],
      nodes: {
        "node-1": {
          id: "node-1",
          parentId: null,
          children: [],
          text: "Focused bullet",
          collapsed: false,
          runStatus: "idle",
          metadata: {},
        },
      },
      focusedNodeId: "node-1",
    },
    ...overrides,
  }
}

function collectEvents(wsUrl: string, count: number): {
  opened: Promise<void>
  events: Promise<AgentRuntimeEvent[]>
} {
  const events: AgentRuntimeEvent[] = []
  let markOpen!: () => void
  const opened = new Promise<void>((resolve) => {
    markOpen = resolve
  })

  const eventsPromise = new Promise<AgentRuntimeEvent[]>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`Timed out waiting for ${count} events; received ${events.length}.`))
    }, 1_000)

    ws.on("open", () => {
      markOpen()
    })
    ws.on("message", (data) => {
      events.push(JSON.parse(data.toString()) as AgentRuntimeEvent)
      if (events.length === count) {
        clearTimeout(timeout)
        ws.close()
        resolve(events)
      }
    })
    ws.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  return { opened, events: eventsPromise }
}

describe("runtime server", () => {
  it("serves health JSON", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, name: "actionpad-runtime" })
  })

  it("accepts a run and streams fake provider events to websocket clients", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })
    const collector = collectEvents(handle.wsUrl, 6)
    await collector.opened

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })

    const events = await collector.events

    expect(events.map((event) => event.type)).toEqual([
      "run-started",
      "assistant-message-started",
      "assistant-delta",
      "assistant-message-completed",
      "outline-patch",
      "run-completed",
    ])
    expect(events[0]).toMatchObject({ runId: "fake-run-node-1", threadId: "fake-thread-node-1" })
    expect(events[4]).toMatchObject({
      patch: {
        type: "append-child-bullets",
        parentId: "node-1",
        bullets: [
          { text: "Clarify the next action." },
          { text: "Identify the smallest useful test." },
          { text: "Note the follow-up decision." },
        ],
      },
    })
  })

  it("rejects invalid run requests", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "codex", nodeId: "node-1" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid run request." })
  })

  it("rejects unsupported providers", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest({ provider: "missing" as StartRunRequest["provider"] })),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Unsupported provider." })
  })
})
