import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import { WebSocketServer, type WebSocket } from "ws"
import type {
  AgentRuntimeEvent,
  RunId,
  SendMessageRequest,
  StartRunRequest,
} from "../src/domain/runtimeProtocol"
import { isBulletMention } from "../src/domain/runtimeProtocol"
import type { AgentProvider, AgentProviderEvent } from "./provider"
import { buildMentionContext, listFilesystemEntries } from "./filesystem"
import { logRuntimeMessage, type RuntimeLogger } from "./runtimeLogger"

export type RuntimeServerHandle = {
  url: string
  wsUrl: string
  close: () => Promise<void>
}

type RuntimeServerOptions = {
  port: number
  providers: AgentProvider[]
  workspace?: string
  logger?: RuntimeLogger
}

type JsonResponse = Record<string, unknown>

type ActiveRun = {
  provider: AgentProvider
  runId: RunId | null
  cancelled: boolean
  task: Promise<void>
}

const shutdownWaitMs = 250

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function sendJson(response: ServerResponse, status: number, body: JsonResponse): void {
  response.writeHead(status, { ...corsHeaders, "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, corsHeaders)
  response.end()
}

function validateStartRunRequest(value: unknown): value is StartRunRequest {
  if (!isRecord(value)) {
    return false
  }
  if (
    !isNonEmptyString(value.provider) ||
    !isNonEmptyString(value.nodeId) ||
    !isNonEmptyString(value.prompt) ||
    typeof value.context !== "string"
  ) {
    return false
  }
  if (!isRecord(value.outline)) {
    return false
  }
  const mentions = value.mentions
  return (
    Array.isArray(value.outline.rootIds) &&
    value.outline.rootIds.every((id) => typeof id === "string") &&
    isRecord(value.outline.nodes) &&
    (typeof value.outline.focusedNodeId === "string" || value.outline.focusedNodeId === null) &&
    (mentions === undefined || (Array.isArray(mentions) && mentions.every(isBulletMention)))
  )
}

function validateSendMessageRequest(value: unknown): value is SendMessageRequest {
  if (!validateStartRunRequest(value) || !isRecord(value)) return false
  const record = value as Record<string, unknown>
  return (
    isNonEmptyString(record.threadId) &&
    (record.providerThreadId === undefined ||
      record.providerThreadId === null ||
      typeof record.providerThreadId === "string")
  )
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

async function attachMentionContext<T extends StartRunRequest | SendMessageRequest>(
  request: T,
  workspace: string,
): Promise<T> {
  const mentions = request.mentions ?? []
  if (mentions.length === 0) return request

  const mentionContext = await buildMentionContext({ mentions, workspace })
  if (!mentionContext) return request

  return {
    ...request,
    context: [request.context, mentionContext].filter(Boolean).join("\n\n"),
  }
}

function broadcast(clients: Set<WebSocket>, event: AgentProviderEvent): void {
  const payload = JSON.stringify(event)
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload)
    }
  }
}

function getEventRunId(event: AgentProviderEvent): RunId | null {
  return "runId" in event ? event.runId : null
}

function waitForRunToSettle(run: ActiveRun): Promise<unknown> {
  return Promise.race([
    run.task,
    new Promise<void>((resolve) => {
      setTimeout(resolve, shutdownWaitMs)
    }),
  ])
}

function waitForShutdownGrace(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, shutdownWaitMs)
  })
}

function cancelRunPathname(pathname: string): RunId | null {
  const match = /^\/runs\/([^/]+)\/cancel$/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

export async function startRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServerHandle> {
  const providers = new Map(options.providers.map((provider) => [provider.id, provider]))
  const workspace = options.workspace ?? process.cwd()
  const logger = options.logger ?? { info: (message: string) => console.log(message) }
  const clients = new Set<WebSocket>()
  const activeRuns = new Set<ActiveRun>()
  const httpSockets = new Set<Socket>()
  let isClosing = false
  let closePromise: Promise<void> | null = null

  function streamProviderEvents(provider: AgentProvider, events: AsyncIterable<AgentProviderEvent>) {
    const activeRun: ActiveRun = {
      provider,
      runId: null,
      cancelled: false,
      task: Promise.resolve(),
    }
    activeRuns.add(activeRun)
    activeRun.task = (async () => {
      try {
        for await (const event of events) {
          if (activeRun.cancelled) continue
          activeRun.runId ??= getEventRunId(event)
          logRuntimeMessage(logger, { type: "provider-event", provider: provider.id, event })
          broadcast(clients, event)
        }
      } catch (error) {
        if (activeRun.cancelled) return
        const message = error instanceof Error ? error.message : "Runtime provider failed."
        const failedEvent: AgentRuntimeEvent = {
          type: "run-failed",
          runId: activeRun.runId ?? "unknown",
          error: message,
          createdAt: Date.now(),
        }
        logRuntimeMessage(logger, { type: "provider-event", provider: provider.id, event: failedEvent })
        broadcast(clients, failedEvent)
      } finally {
        activeRuns.delete(activeRun)
      }
    })()
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
      if (request.method === "OPTIONS") {
        sendNoContent(response)
        return
      }

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(response, 200, { ok: true, name: "actionpad-runtime" })
        return
      }

      if (request.method === "GET" && requestUrl.pathname === "/filesystem/list") {
        try {
          const listed = await listFilesystemEntries({
            path: requestUrl.searchParams.get("path"),
            workspace,
            showHidden: requestUrl.searchParams.get("query")?.startsWith(".") ?? false,
          })
          sendJson(response, 200, listed)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not list folder."
          sendJson(response, 400, { error: message })
        }
        return
      }

      if (request.method === "POST" && requestUrl.pathname === "/runs") {
        if (isClosing) {
          sendJson(response, 503, { error: "Runtime is shutting down." })
          return
        }

        let body: unknown
        try {
          body = await readJson(request)
        } catch {
          sendJson(response, 400, { error: "Invalid run request." })
          return
        }
        if (isClosing) {
          sendJson(response, 503, { error: "Runtime is shutting down." })
          return
        }

        if (!validateStartRunRequest(body)) {
          sendJson(response, 400, { error: "Invalid run request." })
          return
        }

        const provider = providers.get(body.provider)
        if (!provider) {
          sendJson(response, 400, { error: "Unsupported provider." })
          return
        }
        if (isClosing) {
          sendJson(response, 503, { error: "Runtime is shutting down." })
          return
        }

        sendJson(response, 202, { accepted: true })
        logRuntimeMessage(logger, {
          type: "chat-start",
          kind: "run",
          provider: provider.id,
          nodeId: body.nodeId,
          prompt: body.prompt,
        })
        const enrichedBody = await attachMentionContext(body, workspace)
        streamProviderEvents(provider, provider.startRun(enrichedBody))
        return
      }

      const cancelRunId = cancelRunPathname(requestUrl.pathname)
      if (request.method === "POST" && cancelRunId) {
        const activeRun = Array.from(activeRuns).find((run) => run.runId === cancelRunId)
        if (!activeRun) {
          sendJson(response, 404, { error: "Run is no longer active." })
          return
        }

        logRuntimeMessage(logger, { type: "chat-stop", runId: cancelRunId })
        try {
          await activeRun.provider.cancelRun(cancelRunId)
        } catch {
          sendJson(response, 500, { error: "Could not stop the run." })
          return
        }

        activeRun.cancelled = true
        const cancelledEvent: AgentRuntimeEvent = {
          type: "run-failed",
          runId: cancelRunId,
          error: "Cancelled.",
          createdAt: Date.now(),
        }
        logRuntimeMessage(logger, {
          type: "provider-event",
          provider: activeRun.provider.id,
          event: cancelledEvent,
        })
        broadcast(clients, cancelledEvent)
        sendJson(response, 202, { cancelled: true })
        return
      }

      if (request.method === "POST" && requestUrl.pathname === "/messages") {
        if (isClosing) {
          sendJson(response, 503, { error: "Runtime is shutting down." })
          return
        }

        let body: unknown
        try {
          body = await readJson(request)
        } catch {
          sendJson(response, 400, { error: "Invalid message request." })
          return
        }

        if (!validateSendMessageRequest(body)) {
          sendJson(response, 400, { error: "Invalid message request." })
          return
        }

        const provider = providers.get(body.provider)
        if (!provider) {
          sendJson(response, 400, { error: "Unsupported provider." })
          return
        }

        sendJson(response, 202, { accepted: true })
        logRuntimeMessage(logger, {
          type: "chat-start",
          kind: "follow-up",
          provider: provider.id,
          nodeId: body.nodeId,
          threadId: body.threadId,
          prompt: body.prompt,
        })
        const enrichedBody = await attachMentionContext(body, workspace)
        streamProviderEvents(provider, provider.sendMessage(enrichedBody))
        return
      }

      sendJson(response, 404, { error: "Not found." })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime server failed."
      console.error(message)
      sendJson(response, 500, { error: "Runtime server failed." })
    }
  })

  const wsServer = new WebSocketServer({ noServer: true })
  server.on("connection", (socket) => {
    httpSockets.add(socket)
    socket.on("close", () => {
      httpSockets.delete(socket)
    })
  })

  wsServer.on("connection", (socket) => {
    clients.add(socket)
    socket.on("close", () => clients.delete(socket))
  })

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/events") {
      socket.destroy()
      return
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit("connection", ws, request)
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(options.port, "127.0.0.1")
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Runtime server did not bind to a TCP port.")
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/events`,
    close: async () => {
      if (closePromise) {
        return closePromise
      }
      isClosing = true
      closePromise = (async () => {
        const runs = Array.from(activeRuns)
        const knownRuns = runs.filter(
          (run): run is ActiveRun & { runId: RunId } => run.runId !== null,
        )
        await Promise.allSettled(
          knownRuns.map((run) => Promise.resolve(run.provider.cancelRun(run.runId))),
        )
        await Promise.allSettled(runs.map(waitForRunToSettle))
        for (const client of clients) {
          client.terminate()
        }
        await waitForShutdownGrace()
        for (const socket of httpSockets) {
          socket.destroy()
        }
        await new Promise<void>((resolve, reject) => {
          wsServer.close((wsError) => {
            if (wsError) {
              reject(wsError)
              return
            }
            server.close((serverError) => {
              if (serverError) {
                reject(serverError)
                return
              }
              resolve()
            })
          })
        })
      })()
      return closePromise
    },
  }
}
