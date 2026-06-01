/// <reference types="vite/client" />

import type {
  AgentRuntimeEvent,
  FilesystemListResponse,
  SendMessageRequest,
  StartRunRequest,
} from "../domain/runtimeProtocol"

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:43217"
const UNSUPPORTED_PROTOCOL_ERROR = "Actionpad runtime URL must use http or https."

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

  subscribe(
    onEvent: (event: AgentRuntimeEvent) => void,
    onConnectionChange?: (connected: boolean) => void,
  ): () => void {
    const socket = new WebSocket(this.eventsUrl())

    socket.onopen = () => onConnectionChange?.(true)
    socket.onclose = () => onConnectionChange?.(false)
    socket.onmessage = (event) => {
      onEvent(JSON.parse(event.data) as AgentRuntimeEvent)
    }

    return () => socket.close()
  }

  private eventsUrl(): string {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return this.urlWithPath(url, "/events")
  }

  private runtimeUrl(pathname: string): string {
    return this.urlWithPath(new URL(this.baseUrl), pathname)
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
