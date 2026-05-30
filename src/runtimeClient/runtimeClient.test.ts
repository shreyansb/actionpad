import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentRuntimeEvent, StartRunRequest } from "../domain/runtimeProtocol"
import { ActionpadRuntimeClient, getRuntimeUrl } from "./runtimeClient"

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
    vi.unstubAllEnvs()
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

  it("posts startRun requests after clearing configured query strings and hashes", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }))

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217/runtime?token=abc#local")
    await client.startRun(request)

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:43217/runs",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("rejects non-OK startRun responses with the runtime error message", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Provider rejected the prompt." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")

    await expect(client.startRun(request)).rejects.toThrow("Provider rejected the prompt.")
  })

  it("rejects non-OK startRun responses with a fallback when error parsing fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: vi.fn().mockRejectedValue(new Error("No JSON available.")),
    } as unknown as Response)

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")

    await expect(client.startRun(request)).rejects.toThrow(
      "Actionpad runtime rejected the run.",
    )
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

  it("opens secure WebSocket event streams for https runtime URLs", () => {
    const client = new ActionpadRuntimeClient("https://runtime.example.test")
    client.subscribe(vi.fn())

    expect(sockets[0].url).toBe("wss://runtime.example.test/events")
  })

  it("reports disconnected when the event socket closes", () => {
    const onConnectionChange = vi.fn()

    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")
    client.subscribe(vi.fn(), onConnectionChange)

    sockets[0].onclose?.()

    expect(onConnectionChange).toHaveBeenCalledWith(false)
  })

  it("returns an unsubscribe function that closes the socket", () => {
    const client = new ActionpadRuntimeClient("http://127.0.0.1:43217")
    const unsubscribe = client.subscribe(vi.fn())

    unsubscribe()

    expect(sockets[0].close).toHaveBeenCalledOnce()
  })

  it("rejects runtime URLs that do not use http or https", () => {
    expect(() => new ActionpadRuntimeClient("file:///tmp/actionpad-runtime")).toThrow(
      "Actionpad runtime URL must use http or https.",
    )
  })

  it("reads the runtime URL from Vite env when configured", () => {
    vi.stubEnv("VITE_ACTIONPAD_RUNTIME_URL", "https://runtime.example.test")

    expect(getRuntimeUrl()).toBe("https://runtime.example.test")
  })

  it("falls back to the default runtime URL when Vite env is unset", () => {
    vi.stubEnv("VITE_ACTIONPAD_RUNTIME_URL", undefined)

    expect(getRuntimeUrl()).toBe("http://127.0.0.1:43217")
  })
})
