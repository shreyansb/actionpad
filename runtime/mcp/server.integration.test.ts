// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createActionpadMcpServer } from "./server"
import { assertStdioTransportConfig } from "./stdioMain"
import type { ActionpadMcpAuditRecord, ActionpadMcpProfile } from "./types"

type RuntimeClient = {
  requestAppRefresh: ReturnType<typeof vi.fn>
  requestRuntimeRestart: ReturnType<typeof vi.fn>
}

function textContent(
  result: Awaited<ReturnType<Client["callTool"]>>,
): Array<{ type: string; text: string }> {
  return result.content as Array<{ type: string; text: string }>
}

async function createHarness(profile: ActionpadMcpProfile): Promise<{
  auditRecords: ActionpadMcpAuditRecord[]
  client: Client
  runtimeClient: RuntimeClient
  server: ReturnType<typeof createActionpadMcpServer>
}> {
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
  const server = createActionpadMcpServer({
    profile,
    runtimeClient,
    auditLogger: {
      async record(record) {
        auditRecords.push(record)
      },
    },
  })
  const client = new Client({ name: "actionpad-mcp-test-client", version: "0.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  return { auditRecords, client, runtimeClient, server }
}

describe("Actionpad MCP server", () => {
  const servers: Array<ReturnType<typeof createActionpadMcpServer>> = []
  const clients: Client[] = []

  afterEach(async () => {
    await Promise.allSettled(clients.map((client) => client.close()))
    await Promise.allSettled(servers.map((server) => server.close()))
    clients.length = 0
    servers.length = 0
  })

  async function trackedHarness(profile: ActionpadMcpProfile) {
    const harness = await createHarness(profile)
    servers.push(harness.server)
    clients.push(harness.client)
    return harness
  }

  it("registers only profile-visible tools for agent, admin, and unknown profiles", async () => {
    for (const profile of ["agent", "admin"] as const) {
      const { client } = await trackedHarness(profile)

      const { tools } = await client.listTools()

      expect(tools.map((tool) => tool.name)).toEqual([
        "request_app_refresh",
        "request_runtime_restart",
      ])
      expect(tools[0]).toMatchObject({
        name: "request_app_refresh",
        title: "Request app refresh",
        description: expect.stringContaining("refresh"),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
          title: "Request app refresh",
        },
      })
      expect(tools[0].inputSchema.type).toBe("object")
      expect(tools[0].outputSchema?.type).toBe("object")
    }

    const { client } = await trackedHarness("unknown")

    await expect(client.listTools()).resolves.toEqual({ tools: [] })
  })

  it("delegates registered tool calls to the runtime client and returns structured content", async () => {
    const { auditRecords, client, runtimeClient } = await trackedHarness("agent")

    const result = await client.callTool(
      {
        name: "request_app_refresh",
        arguments: { reason: "Reload after MCP server edits." },
      },
      CallToolResultSchema,
    )

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      requested: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(runtimeClient.requestAppRefresh).toHaveBeenCalledTimes(1)
    expect(runtimeClient.requestRuntimeRestart).not.toHaveBeenCalled()
    expect(auditRecords[0]).toMatchObject({
      profile: "agent",
      toolName: "request_app_refresh",
      allowed: true,
      outcome: "succeeded",
    })
  })

  it("audits malformed registered tool calls before returning errors", async () => {
    const { auditRecords, client, runtimeClient } = await trackedHarness("agent")

    const result = await client.callTool(
      {
        name: "request_app_refresh",
        arguments: { reason: "" },
      },
      CallToolResultSchema,
    )

    expect(result.isError).toBe(true)
    expect(textContent(result)[0]).toMatchObject({
      type: "text",
      text: "Invalid request_app_refresh arguments (reason: reason must be non-empty)",
    })
    expect(runtimeClient.requestAppRefresh).not.toHaveBeenCalled()
    expect(auditRecords[0]).toMatchObject({
      profile: "agent",
      toolName: "request_app_refresh",
      allowed: true,
      outcome: "failed",
      error: "Invalid request_app_refresh arguments (reason: reason must be non-empty)",
    })
  })

  it("returns policy denials through registered server calls before runtime calls", async () => {
    const { auditRecords, client, runtimeClient } = await trackedHarness("agent")

    const result = await client.callTool(
      {
        name: "request_runtime_restart",
        arguments: { reason: "Restart without explicit intent." },
      },
      CallToolResultSchema,
    )

    expect(result.isError).toBe(true)
    expect(textContent(result)[0]).toMatchObject({
      type: "text",
      text: "agent restart requires explicit user intent",
    })
    expect(runtimeClient.requestRuntimeRestart).not.toHaveBeenCalled()
    expect(auditRecords[0]).toMatchObject({
      profile: "agent",
      toolName: "request_runtime_restart",
      allowed: false,
      outcome: "denied",
    })
  })

  it("does not register unknown-profile tools and audits direct calls", async () => {
    const { auditRecords, client, runtimeClient } = await trackedHarness("unknown")

    const result = await client.callTool(
      {
        name: "request_app_refresh",
        arguments: { reason: "Try refresh from unknown profile." },
      },
      CallToolResultSchema,
    )

    expect(result.isError).toBe(true)
    expect(textContent(result)[0]).toMatchObject({
      type: "text",
      text: "unknown profile is not authorized",
    })
    expect(runtimeClient.requestAppRefresh).not.toHaveBeenCalled()
    expect(auditRecords[0]).toMatchObject({
      profile: "unknown",
      toolName: "request_app_refresh",
      allowed: false,
      outcome: "denied",
    })
  })
})

describe("Actionpad MCP stdio entrypoint", () => {
  it("rejects HTTP transport config before opening stdio", () => {
    expect(() =>
      assertStdioTransportConfig({
        runtimeUrl: "http://127.0.0.1:43217",
        profile: "agent",
        transport: "http",
        http: {
          host: "127.0.0.1",
          port: 43218,
        },
      }),
    ).toThrow("ACTIONPAD_MCP_TRANSPORT=http is not supported by the stdio entrypoint.")
  })
})
