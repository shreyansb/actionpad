import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { parseActionpadMcpConfig } from "./config"
import { createActionpadMcpServerFromConfig } from "./server"
import type { ActionpadMcpConfig } from "./types"
import { isCompiledRuntime } from "../isCompiledRuntime"

type Env = Record<string, string | undefined>

export function assertStdioTransportConfig(config: ActionpadMcpConfig): void {
  if (config.transport === "http") {
    throw new Error("ACTIONPAD_MCP_TRANSPORT=http is not supported by the stdio entrypoint.")
  }
}

export async function startActionpadMcpStdioServer(env: Env = process.env): Promise<McpServer> {
  const config = parseActionpadMcpConfig(env)
  assertStdioTransportConfig(config)

  const server = createActionpadMcpServerFromConfig(config)
  await server.connect(new StdioServerTransport())
  console.error("Actionpad MCP server running on stdio.")
  return server
}

function installShutdownHandlers(server: McpServer): void {
  let closing = false

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (closing) return
    closing = true

    try {
      console.error(`Actionpad MCP server received ${signal}; shutting down.`)
      await server.close()
      process.exit(0)
    } catch (error) {
      console.error("Actionpad MCP server shutdown failed:", error)
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

export async function runActionpadMcpStdio(env: Env = process.env): Promise<void> {
  const server = await startActionpadMcpStdioServer(env)
  installShutdownHandlers(server)
}

if (!isCompiledRuntime(process.execPath) && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runActionpadMcpStdio().catch((error) => {
    console.error("Actionpad MCP server failed:", error)
    process.exit(1)
  })
}
