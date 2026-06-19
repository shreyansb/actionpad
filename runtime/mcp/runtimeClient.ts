import type { RequestAppRefreshResult, RequestRuntimeRestartResult } from "./types"

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

type ActionpadRuntimeClientOptions = {
  runtimeUrl: string
  fetch?: FetchLike
}

type ActionpadRuntimeClient = {
  requestAppRefresh(): Promise<RequestAppRefreshResult>
  requestRuntimeRestart(): Promise<RequestRuntimeRestartResult>
}

const maxErrorTextLength = 160

function endpointUrl(runtimeUrl: string, path: string): string {
  return new URL(path, runtimeUrl).toString()
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function conciseText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxErrorTextLength) return trimmed
  return `${trimmed.slice(0, maxErrorTextLength - 3)}...`
}

function fetchErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const cause =
    error && typeof error === "object" ? (error as Record<string, unknown>).cause : undefined
  if (!cause || typeof cause !== "object") return message

  const causeRecord = cause as Record<string, unknown>
  const code = stringField(causeRecord.code)
  const causeMessage = cause instanceof Error ? cause.message : String(cause)
  const address = stringField(causeRecord.address)
  const port = numberField(causeRecord.port)
  const endpoint = address && port !== null ? ` ${address}:${port}` : ""
  const causePrefix = code ? `${code} ` : ""

  return `${message} (cause: ${causePrefix}${causeMessage}${endpoint})`
}

async function parseJsonObject(response: Response, method: string, path: string): Promise<Record<string, unknown>> {
  const body = (await response.json()) as unknown
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`Actionpad runtime request failed: ${method} ${path} returned invalid JSON.`)
  }
  return body as Record<string, unknown>
}

async function postJson(
  fetchImpl: FetchLike,
  runtimeUrl: string,
  path: string,
): Promise<Record<string, unknown>> {
  const method = "POST"
  const url = endpointUrl(runtimeUrl, path)
  let response: Response

  try {
    response = await fetchImpl(url, {
      method,
      headers: { accept: "application/json" },
    })
  } catch (error) {
    throw new Error(
      `Actionpad runtime request failed: ${method} ${path} to ${runtimeUrl} failed: ${fetchErrorDetail(error)}`,
    )
  }

  if (!response.ok) {
    const body = conciseText(await response.text())
    const detail = body ? `: ${body}` : ""
    throw new Error(
      `Actionpad runtime request failed: ${method} ${path} returned HTTP ${response.status}${detail}`,
    )
  }

  return parseJsonObject(response, method, path)
}

function booleanField(body: Record<string, unknown>, fieldName: string, path: string): boolean {
  const value = body[fieldName]
  if (typeof value !== "boolean") {
    throw new Error(`Actionpad runtime request failed: POST ${path} returned invalid ${fieldName}.`)
  }
  return value
}

export function createActionpadRuntimeClient(options: ActionpadRuntimeClientOptions): ActionpadRuntimeClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)

  return {
    async requestAppRefresh(): Promise<RequestAppRefreshResult> {
      const body = await postJson(fetchImpl, options.runtimeUrl, "/app/refresh")
      return {
        requested: booleanField(body, "requested", "/app/refresh"),
        runtimeUrl: options.runtimeUrl,
      }
    },

    async requestRuntimeRestart(): Promise<RequestRuntimeRestartResult> {
      const body = await postJson(fetchImpl, options.runtimeUrl, "/runtime/restart")
      return {
        requested: booleanField(body, "requested", "/runtime/restart"),
        pending: booleanField(body, "pending", "/runtime/restart"),
        runtimeUrl: options.runtimeUrl,
      }
    },
  }
}
