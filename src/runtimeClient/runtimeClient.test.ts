import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentRuntimeEvent, StartRunRequest } from "../domain/runtimeProtocol"
import { ActionpadRuntimeClient } from "./runtimeClient"

const request: StartRunRequest = {
  provider: "codex",
  nodeId: "node-1",
  prompt: "Draft the next move.",
  context: "Nearby outline context",
  outline: {
    rootIds: ["node-1"],
    nodes: {
      "node-1": {
        id: "node-1",
        parentId: null,
        children: [],
        text: "Draft the next move.",
        collapsed: false,
        runStatus: "idle",
        metadata: {},
      },
    },
    focusedNodeId: "node-1",
  },
}

type MockWebSocketInstance = {
  url: string
  close: ReturnType<typeof vi.fn>
  onopen: (() => void) | null
  onclose: (() => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
}

const sockets: MockWebSocketInstance[] = []

class MockWebSocket {
  url: string
  close = vi.fn()
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null

  constructor(url: string) {
    this.url = url
    sockets.push(this)
  }
}

describe("ActionpadRuntimeClient", () => {
  beforeEach(() => {
    sockets.length = 0
    vi.stubGlobal("fetch", vi.fn())
    vi.stubGlobal("WebSocket", MockWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts startRun requests to the configured runtime URL", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }))

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217/")
    await client.startRun(request)

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:43217/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
  })

  it("opens a WebSocket event stream and passes parsed runtime events to the callback", () => {
    const event: AgentRuntimeEvent = {
      type: "run-started",
      runId: "run-1",
      threadId: "thread-1",
      nodeId: "node-1",
      createdAt: 123,
    }
    const onEvent = vi.fn()
    const onConnectionChange = vi.fn()

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")
    client.subscribe(onEvent, onConnectionChange)

    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toBe("ws://127.0.0.1:43217/events")

    sockets[0].onopen?.()
    expect(onConnectionChange).toHaveBeenCalledWith(true)

    sockets[0].onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }))
    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it("returns an unsubscribe function that closes the socket", () => {
    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")
    const unsubscribe = client.subscribe(vi.fn())

    unsubscribe()

    expect(sockets[0].close).toHaveBeenCalledOnce()
  })
})
