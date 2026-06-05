// @vitest-environment node
import { createServer } from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createActionpadMcpServer } from "./server"
import {
  assertHttpTransportConfig,
  startActionpadMcpHttpServer,
  type ActionpadMcpHttpServerHandle,
} from "./httpMain"
import type { ActionpadMcpAuditRecord, ActionpadMcpConfig } from "./types"
import type { ActionpadMcpToolState } from "./tools"

const host = "127.0.0.1"

function testConfig(port: number): ActionpadMcpConfig {
  return {
    runtimeUrl: "http://127.0.0.1:43217",
    profile: "agent",
    transport: "http",
    http: {
      host,
      port,
    },
  }
}

async function getFreePort(): Promise<number> {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate an HTTP test port.")
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  return address.port
}

async function expectCanBind(port: number): Promise<void> {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

describe("Actionpad MCP HTTP entrypoint", () => {
  const handles: ActionpadMcpHttpServerHandle[] = []
  const clients: Client[] = []

  afterEach(async () => {
    await Promise.allSettled(clients.map((client) => client.close()))
    await Promise.allSettled(handles.map((handle) => handle.close()))
    clients.length = 0
    handles.length = 0
  })

  it("rejects stdio transport config before opening HTTP", () => {
    expect(() =>
      assertHttpTransportConfig({
        ...testConfig(43218),
        transport: "stdio",
      }),
    ).toThrow("ACTIONPAD_MCP_TRANSPORT=stdio is not supported by the HTTP entrypoint.")
  })

  it("serves health JSON and 404 JSON on non-MCP paths", async () => {
    const handle = await startActionpadMcpHttpServer(testConfig(await getFreePort()))
    handles.push(handle)

    await expect(fetch(`${handle.url}/health`).then((response) => response.json())).resolves.toEqual({
      ok: true,
      name: "actionpad-mcp",
    })

    const response = await fetch(`${handle.url}/missing`)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Not found",
    })
  })

  it("returns 405 for unsupported MCP methods", async () => {
    const handle = await startActionpadMcpHttpServer(testConfig(await getFreePort()))
    handles.push(handle)

    const response = await fetch(handle.mcpUrl, { method: "PUT" })

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Method not allowed",
    })
  })

  it("lists and calls tools over Streamable HTTP with an injected runtime client", async () => {
    const auditRecords: ActionpadMcpAuditRecord[] = []
    const runtimeClient = {
      requestAppRefresh: vi.fn(async () => ({
        requested: true,
        runtimeUrl: "http://127.0.0.1:43217",
      })),
      requestRuntimeRestart: vi.fn(async () => ({
        requested: true,
        pending: true,
        runtimeUrl: "http://127.0.0.1:43217",
      })),
    }
    const handle = await startActionpadMcpHttpServer(testConfig(await getFreePort()), {
      createServer(config, toolState) {
        return createActionpadMcpServer({
          profile: config.profile,
          runtimeClient,
          auditLogger: {
            async record(record) {
              auditRecords.push(record)
            },
          },
          toolState,
        })
      },
    })
    handles.push(handle)

    const client = new Client({ name: "actionpad-http-test-client", version: "0.0.0" })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.mcpUrl)))

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [
        {
          name: "request_app_refresh",
        },
        {
          name: "request_runtime_restart",
        },
      ],
    })

    const result = await client.callTool(
      {
        name: "request_app_refresh",
        arguments: { reason: "Reload after HTTP MCP test edits." },
      },
      CallToolResultSchema,
    )

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      requested: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(runtimeClient.requestAppRefresh).toHaveBeenCalledTimes(1)
    expect(auditRecords[0]).toMatchObject({
      profile: "agent",
      toolName: "request_app_refresh",
      outcome: "succeeded",
    })
  })

  it("shares app refresh rate limiting across stateless HTTP requests", async () => {
    let currentTime = new Date("2026-06-05T12:00:00.000Z")
    const auditRecords: ActionpadMcpAuditRecord[] = []
    const runtimeClient = {
      requestAppRefresh: vi.fn(async () => ({
        requested: true,
        runtimeUrl: "http://127.0.0.1:43217",
      })),
      requestRuntimeRestart: vi.fn(async () => ({
        requested: true,
        pending: true,
        runtimeUrl: "http://127.0.0.1:43217",
      })),
    }
    const handle = await startActionpadMcpHttpServer(testConfig(await getFreePort()), {
      createServer(config, toolState: ActionpadMcpToolState) {
        return createActionpadMcpServer({
          profile: config.profile,
          runtimeClient,
          auditLogger: {
            async record(record) {
              auditRecords.push(record)
            },
          },
          now: () => currentTime,
          toolState,
        })
      },
    })
    handles.push(handle)

    const client = new Client({ name: "actionpad-http-rate-limit-client", version: "0.0.0" })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.mcpUrl)))

    const first = await client.callTool(
      {
        name: "request_app_refresh",
        arguments: { reason: "Reload after first HTTP MCP test edit." },
      },
      CallToolResultSchema,
    )
    currentTime = new Date("2026-06-05T12:00:01.000Z")
    const second = await client.callTool(
      {
        name: "request_app_refresh",
        arguments: { reason: "Reload again immediately over HTTP." },
      },
      CallToolResultSchema,
    )

    expect(first.isError).toBeUndefined()
    expect(second.isError).toBe(true)
    expect(runtimeClient.requestAppRefresh).toHaveBeenCalledTimes(1)
    expect(auditRecords[1]).toMatchObject({
      profile: "agent",
      toolName: "request_app_refresh",
      allowed: false,
      outcome: "denied",
      error: "rate limited",
    })
  })

  it("releases the configured port on close", async () => {
    const port = await getFreePort()
    const handle = await startActionpadMcpHttpServer(testConfig(port))

    await handle.close()

    await expect(expectCanBind(port)).resolves.toBeUndefined()
  })
})
