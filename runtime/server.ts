import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { WebSocketServer, type WebSocket } from "ws"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function sendJson(response: ServerResponse, status: number, body: JsonResponse): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
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

export async function startRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServerHandle> {
  const providers = new Map(options.providers.map((provider) => [provider.id, provider]))
  const clients = new Set<WebSocket>()

  const server = createServer(async (request, response) => {
    try {
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
        queueMicrotask(async () => {
          try {
            for await (const event of provider.startRun(body)) {
              broadcast(clients, event)
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Runtime provider failed."
            console.error(message)
          }
        })
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
