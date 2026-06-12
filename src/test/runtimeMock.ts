import { act } from "react"
import { vi } from "vitest"
import type { AgentRuntimeEvent, StartRunRequest } from "../domain/runtimeProtocol"

export class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  url: string
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent("close"))
  })
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null

  constructor(url: string) {
    this.url = url
    runtimeSockets.push(this)
    queueMicrotask(() => this.onopen?.(new Event("open")))
  }

  emitMessage(event: AgentRuntimeEvent) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }))
  }
}

export const runtimeSockets: MockWebSocket[] = []

export function setupRuntimeMocks(
  options: { activeRuns?: Array<{ runId: string | null; nodeId: string }> } = {},
) {
  runtimeSockets.length = 0
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (method === "GET" && new URL(String(input)).pathname === "/runs") {
      return new Response(JSON.stringify({ runs: options.activeRuns ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response(null, { status: 202 })
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("WebSocket", MockWebSocket)
  return fetchMock
}

export function getLastStartRunRequest(fetchMock: ReturnType<typeof setupRuntimeMocks>) {
  const requestsWithBody = fetchMock.mock.calls.filter(
    (call) => typeof call[1]?.body === "string",
  )
  const body = requestsWithBody.at(-1)?.[1]?.body
  if (typeof body !== "string") {
    throw new Error("Expected a runtime startRun request body.")
  }
  return JSON.parse(body) as StartRunRequest
}

export async function emitRuntimeEvent(event: AgentRuntimeEvent) {
  await act(async () => {
    runtimeSockets[0]?.emitMessage(event)
  })
}

export async function emitRunStartedForLastRequest(
  fetchMock: ReturnType<typeof setupRuntimeMocks>,
  createdAt = 100,
) {
  const request = getLastStartRunRequest(fetchMock)
  await emitRuntimeEvent({
    type: "run-started",
    runId: `run-${request.nodeId}`,
    threadId: `thread-${request.nodeId}`,
    nodeId: request.nodeId,
    createdAt,
  })
  return request
}
