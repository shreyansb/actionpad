/// <reference types="vite/client" />

import type {
  ActiveRunsResponse,
  AgentProviderId,
  AgentRuntimeEvent,
  FilesystemReadResponse,
  FilesystemListResponse,
  SendMessageRequest,
  StartRunRequest,
} from "../domain/runtimeProtocol"

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:5111"
const UNSUPPORTED_PROTOCOL_ERROR = "Actionpad runtime URL must use http or https."
const globalActionpadConfig = "__ACTIONPAD_CONFIG__"

export class ActionpadRuntimeClient {
  private readonly baseUrl: URL

  constructor(baseUrl: string) {
    const url = new URL(baseUrl.replace(/\/+$/, ""))
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(UNSUPPORTED_PROTOCOL_ERROR)
    }
    url.search = ""
    url.hash = ""
    this.baseUrl = url
  }

  async startRun(request: StartRunRequest): Promise<void> {
    const response = await fetch(this.runtimeUrl("/runs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime rejected the run.")
    }
  }

  async sendMessage(request: SendMessageRequest): Promise<void> {
    const response = await fetch(this.runtimeUrl("/messages"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime rejected the message.")
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const response = await fetch(this.runtimeUrl(`/runs/${encodeURIComponent(runId)}/cancel`), {
      method: "POST",
    })

    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime could not stop the run.")
    }
  }

  async listActiveRuns(): Promise<ActiveRunsResponse> {
    const response = await fetch(this.runtimeUrl("/runs"))
    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime could not list runs.")
    }
    return (await response.json()) as ActiveRunsResponse
  }

  async requestAppRefresh(): Promise<void> {
    await this.postRuntimeControl(
      "/app/refresh",
      "Actionpad runtime could not request an app refresh.",
    )
  }

  async requestRuntimeRestart(): Promise<void> {
    await this.postRuntimeControl(
      "/runtime/restart",
      "Actionpad runtime could not request a runtime restart.",
    )
  }

  async listFilesystem(path?: string | null, query = ""): Promise<FilesystemListResponse> {
    const url = new URL(this.runtimeUrl("/filesystem/list"))
    if (path) url.searchParams.set("path", path)
    if (query) url.searchParams.set("query", query)

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime could not list files.")
    }
    return (await response.json()) as FilesystemListResponse
  }

  async readFile(path: string): Promise<FilesystemReadResponse> {
    const url = new URL(this.runtimeUrl("/filesystem/read"))
    url.searchParams.set("path", path)

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime could not read the file.")
    }
    return (await response.json()) as FilesystemReadResponse
  }

  subscribe(
    onEvent: (event: AgentRuntimeEvent) => void,
    onConnectionChange?: (connected: boolean) => void,
  ): () => void {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closedByClient = false

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const connect = () => {
      if (closedByClient) return
      clearReconnectTimer()

      const nextSocket = new WebSocket(this.eventsUrl())
      socket = nextSocket

      nextSocket.onopen = () => onConnectionChange?.(true)
      nextSocket.onclose = () => {
        if (socket === nextSocket) {
          socket = null
        }
        onConnectionChange?.(false)
        if (!closedByClient) {
          reconnectTimer = setTimeout(connect, 1_000)
        }
      }
      nextSocket.onmessage = (event) => {
        onEvent(JSON.parse(event.data) as AgentRuntimeEvent)
      }
    }

    connect()

    return () => {
      closedByClient = true
      clearReconnectTimer()
      socket?.close()
      socket = null
    }
  }

  private eventsUrl(): string {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return this.urlWithPath(url, "/events")
  }

  private runtimeUrl(pathname: string): string {
    return this.urlWithPath(new URL(this.baseUrl), pathname)
  }

  private async postRuntimeControl(pathname: string, fallbackError: string): Promise<void> {
    const response = await fetch(this.runtimeUrl(pathname), { method: "POST" })

    if (!response.ok) {
      throw new Error((await parseError(response)) ?? fallbackError)
    }
  }

  private urlWithPath(url: URL, pathname: string): string {
    url.pathname = pathname
    url.search = ""
    url.hash = ""
    return url.toString()
  }
}

async function parseError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : undefined
  } catch {
    return undefined
  }
}

export function getRuntimeUrl(): string {
  return import.meta.env.VITE_ACTIONPAD_RUNTIME_URL ?? DEFAULT_RUNTIME_URL
}

export function getDefaultProvider(
  env: Record<string, string | undefined> = import.meta.env,
): AgentProviderId {
  const runtimeConfig = (globalThis as Record<string, unknown>)[globalActionpadConfig]
  if (
    runtimeConfig &&
    typeof runtimeConfig === "object" &&
    (runtimeConfig as { provider?: unknown }).provider === "claude"
  ) {
    return "claude"
  }
  return env.VITE_ACTIONPAD_PROVIDER === "claude" ? "claude" : "codex"
}
