import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { parseActionpadMcpConfig } from "./config"
import { createActionpadMcpServerFromConfig } from "./server"
import type { ActionpadMcpConfig } from "./types"
import type { ActionpadMcpToolState } from "./tools"
import { isCompiledRuntime } from "../isCompiledRuntime"

type Env = Record<string, string | undefined>

export type ActionpadMcpHttpServerHandle = {
  url: string
  mcpUrl: string
  close(): Promise<void>
}

export type ActionpadMcpHttpServerOptions = {
  createServer?: (config: ActionpadMcpConfig, toolState: ActionpadMcpToolState) => McpServer
}

function formatUrlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...headers,
  })
  response.end(JSON.stringify(body))
}

export function assertHttpTransportConfig(config: ActionpadMcpConfig): void {
  if (config.transport === "stdio") {
    throw new Error("ACTIONPAD_MCP_TRANSPORT=stdio is not supported by the HTTP entrypoint.")
  }
}

async function handleMcpPost(
  request: IncomingMessage,
  response: ServerResponse,
  config: ActionpadMcpConfig,
  createMcpServer: (config: ActionpadMcpConfig, toolState: ActionpadMcpToolState) => McpServer,
  toolState: ActionpadMcpToolState,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = createMcpServer(config, toolState)

  transport.onerror = (error) => {
    console.error("Actionpad MCP HTTP transport error:", error)
  }

  try {
    await server.connect(transport)
    await transport.handleRequest(request, response)
  } catch (error) {
    console.error("Actionpad MCP HTTP request failed:", error)
    if (!response.headersSent) {
      writeJson(response, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      })
    }
  } finally {
    await Promise.allSettled([server.close(), transport.close()])
  }
}

function createRequestHandler(
  config: ActionpadMcpConfig,
  options: ActionpadMcpHttpServerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const createMcpServer = options.createServer ?? createActionpadMcpServerFromConfig
  const toolState: ActionpadMcpToolState = { lastSuccessfulAppRefreshAt: null }

  return (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${formatUrlHost(config.http.host)}`)

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      writeJson(response, 200, { ok: true, name: "actionpad-mcp" })
      return
    }

    if (requestUrl.pathname === "/mcp") {
      if (request.method !== "POST") {
        writeJson(response, 405, { ok: false, error: "Method not allowed" }, { allow: "POST" })
        return
      }

      void handleMcpPost(request, response, config, createMcpServer, toolState)
      return
    }

    writeJson(response, 404, { ok: false, error: "Not found" })
  }
}

export async function startActionpadMcpHttpServer(
  config: ActionpadMcpConfig,
  options: ActionpadMcpHttpServerOptions = {},
): Promise<ActionpadMcpHttpServerHandle> {
  assertHttpTransportConfig(config)

  const httpServer = createServer(createRequestHandler(config, options))

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject)
    httpServer.listen(config.http.port, config.http.host, () => {
      httpServer.off("error", reject)
      resolve()
    })
  })

  const url = `http://${formatUrlHost(config.http.host)}:${config.http.port}`
  console.error(`Actionpad MCP HTTP server listening at ${url}/mcp.`)

  let closePromise: Promise<void> | undefined

  return {
    url,
    mcpUrl: `${url}/mcp`,
    close() {
      closePromise ??= closeHttpServer(httpServer)
      return closePromise
    },
  }
}

function closeHttpServer(httpServer: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!httpServer.listening) {
      resolve()
      return
    }

    httpServer.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function installShutdownHandlers(handle: ActionpadMcpHttpServerHandle): void {
  let closing = false

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (closing) return
    closing = true

    try {
      console.error(`Actionpad MCP HTTP server received ${signal}; shutting down.`)
      await handle.close()
      process.exit(0)
    } catch (error) {
      console.error("Actionpad MCP HTTP server shutdown failed:", error)
      process.exit(1)
    }
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT")
  })
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM")
  })
}

export async function startActionpadMcpHttpServerFromEnv(
  env: Env = process.env,
): Promise<ActionpadMcpHttpServerHandle> {
  const config = parseActionpadMcpConfig(env)
  return startActionpadMcpHttpServer(config)
}

export async function runActionpadMcpHttp(env: Env = process.env): Promise<void> {
  const handle = await startActionpadMcpHttpServerFromEnv(env)
  installShutdownHandlers(handle)
}

if (!isCompiledRuntime(process.execPath) && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runActionpadMcpHttp().catch((error) => {
    console.error("Actionpad MCP HTTP server failed:", error)
    process.exit(1)
  })
}
