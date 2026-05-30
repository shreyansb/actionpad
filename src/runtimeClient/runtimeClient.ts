import type { AgentRuntimeEvent, StartRunRequest } from "../domain/runtimeProtocol"

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:43217"

export class ActionpadRuntimeClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  async startRun(request: StartRunRequest): Promise<void> {
    const response = await fetch(`${this.baseUrl}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error((await parseError(response)) ?? "Actionpad runtime rejected the run.")
    }
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
    url.pathname = "/events"
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
  const meta = import.meta as ImportMeta & {
    readonly env?: { readonly VITE_ACTIONPAD_RUNTIME_URL?: string }
  }
  return meta.env?.VITE_ACTIONPAD_RUNTIME_URL ?? DEFAULT_RUNTIME_URL
}
