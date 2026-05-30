import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { WebSocketServer, type WebSocket } from "ws"
import type { AgentRuntimeEvent, RunId, StartRunRequest } from "../src/domain/runtimeProtocol"
import type { AgentProvider, AgentProviderEvent } from "./provider"

export type RuntimeServerHandle = {
  url: string
  wsUrl: string
  close: () => Promise<void>
}

type RuntimeServerOptions = {
  port: number
  providers: AgentProvider[]
}

type JsonResponse = Record<string, unknown>

type ActiveRun = {
  provider: AgentProvider
  runId: RunId | null
  task: Promise<void>
}

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
  return (
    Array.isArray(value.outline.rootIds) &&
    value.outline.rootIds.every((id) => typeof id === "string") &&
    isRecord(value.outline.nodes) &&
    (typeof value.outline.focusedNodeId === "string" || value.outline.focusedNodeId === null)
  )
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
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

export async function startRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServerHandle> {
  const providers = new Map(options.providers.map((provider) => [provider.id, provider]))
  const clients = new Set<WebSocket>()
  const activeRuns = new Set<ActiveRun>()

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        sendNoContent(response)
        return
      }

      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { ok: true, name: "actionpad-runtime" })
        return
      }

      if (request.method === "POST" && request.url === "/runs") {
        let body: unknown
        try {
          body = await readJson(request)
        } catch {
          sendJson(response, 400, { error: "Invalid run request." })
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

        sendJson(response, 202, { accepted: true })
        const activeRun: ActiveRun = {
          provider,
          runId: null,
          task: Promise.resolve(),
        }
        activeRuns.add(activeRun)
        activeRun.task = (async () => {
          try {
            for await (const event of provider.startRun(body)) {
              activeRun.runId ??= getEventRunId(event)
              broadcast(clients, event)
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Runtime provider failed."
            const failedEvent: AgentRuntimeEvent = {
              type: "run-failed",
              runId: activeRun.runId ?? "unknown",
              error: message,
              createdAt: Date.now(),
            }
            broadcast(clients, failedEvent)
          } finally {
            activeRuns.delete(activeRun)
          }
        })()
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
      const runs = Array.from(activeRuns)
      const knownRuns = runs.filter((run): run is ActiveRun & { runId: RunId } => run.runId !== null)
      await Promise.allSettled(
        knownRuns.map((run) => Promise.resolve(run.provider.cancelRun(run.runId))),
      )
      await Promise.allSettled(runs.map((run) => run.task))
      for (const client of clients) {
        client.close()
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
    },
  }
}
