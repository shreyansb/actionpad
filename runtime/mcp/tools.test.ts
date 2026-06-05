// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { createActionpadMcpTools } from "./tools"
import type { ActionpadMcpAuditRecord, ActionpadMcpProfile } from "./types"

function jsonContent(result: { content: Array<{ type: string; text: string }> }): unknown {
  expect(result.content).toHaveLength(1)
  expect(result.content[0].type).toBe("text")
  return JSON.parse(result.content[0].text)
}

function textContent(result: { content: Array<{ type: string; text: string }> }): string {
  expect(result.content).toHaveLength(1)
  expect(result.content[0].type).toBe("text")
  return result.content[0].text
}

function createHarness(
  profile: ActionpadMcpProfile,
  options: { now?: () => Date } = {},
): {
  auditRecords: ActionpadMcpAuditRecord[]
  runtimeClient: {
    requestAppRefresh: ReturnType<typeof vi.fn>
    requestRuntimeRestart: ReturnType<typeof vi.fn>
  }
  tools: ReturnType<typeof createActionpadMcpTools>
} {
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
  const tools = createActionpadMcpTools({
    profile,
    runtimeClient,
    auditLogger: {
      async record(record) {
        auditRecords.push(record)
      },
    },
    now: options.now,
  })

  return { auditRecords, runtimeClient, tools }
}

describe("Actionpad MCP tools", () => {
  it("lists profile-filtered tool definitions for agent, admin, and unknown profiles", () => {
    for (const profile of ["agent", "admin"] as const) {
      const { tools } = createHarness(profile)
      const listedTools = tools.listTools()

      expect(listedTools.map((tool) => tool.name)).toEqual([
        "request_app_refresh",
        "request_runtime_restart",
      ])
      expect(listedTools[0]).toMatchObject({
        name: "request_app_refresh",
        title: "Request app refresh",
      })
      expect(listedTools[0].description).toContain("refresh")
      expect(listedTools[0].annotations).toMatchObject({
        destructiveHint: false,
        readOnlyHint: false,
      })
      expect(listedTools[0].inputSchema.safeParse({ reason: "Reload after UI edits." }).success).toBe(
        true,
      )
      expect(
        listedTools[0].outputSchema.safeParse({
          requested: true,
          runtimeUrl: "http://127.0.0.1:43217",
        }).success,
      ).toBe(true)
    }

    expect(createHarness("unknown").tools.listTools()).toEqual([])
  })

  it("successfully requests app refresh, returns JSON content, and audits success", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("agent")

    const result = await tools.callTool("request_app_refresh", {
      reason: "Reload after CSS changes.",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      requested: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(jsonContent(result)).toEqual({
      requested: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(runtimeClient.requestAppRefresh).toHaveBeenCalledTimes(1)
    expect(runtimeClient.requestRuntimeRestart).not.toHaveBeenCalled()
    expect(auditRecords).toEqual([
      {
        profile: "agent",
        toolName: "request_app_refresh",
        allowed: true,
        arguments: { reason: "Reload after CSS changes." },
        runtimeUrl: "http://127.0.0.1:43217",
        outcome: "succeeded",
        reason: "profile may request app refresh",
      },
    ])
  })

  it("rate limits successful app refresh calls without a second runtime call", async () => {
    let currentTime = new Date("2026-06-05T12:00:00.000Z")
    const { auditRecords, runtimeClient, tools } = createHarness("agent", {
      now: () => currentTime,
    })

    await tools.callTool("request_app_refresh", { reason: "Reload after edits." })
    currentTime = new Date("2026-06-05T12:00:01.000Z")
    const result = await tools.callTool("request_app_refresh", {
      reason: "Reload again immediately.",
    })

    expect(result.isError).toBe(true)
    expect(textContent(result)).toContain("rate limit")
    expect(runtimeClient.requestAppRefresh).toHaveBeenCalledTimes(1)
    expect(auditRecords[1]).toEqual({
      profile: "agent",
      toolName: "request_app_refresh",
      allowed: false,
      arguments: { reason: "Reload again immediately." },
      outcome: "denied",
      reason: "rate limited: app refresh requested too frequently",
      error: "rate limited",
    })
  })

  it("allows agent runtime restart with approved user intent", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("agent")

    const result = await tools.callTool("request_runtime_restart", {
      reason: "Runtime source changed.",
      userIntent: "runtime_changes_need_reload",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      requested: true,
      pending: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(jsonContent(result)).toEqual({
      requested: true,
      pending: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(runtimeClient.requestRuntimeRestart).toHaveBeenCalledTimes(1)
    expect(auditRecords).toEqual([
      {
        profile: "agent",
        toolName: "request_runtime_restart",
        allowed: true,
        arguments: {
          reason: "Runtime source changed.",
          userIntent: "runtime_changes_need_reload",
        },
        runtimeUrl: "http://127.0.0.1:43217",
        outcome: "succeeded",
        reason: "agent restart intent is allowed",
      },
    ])
  })

  it("denies agent runtime restart without or with invalid user intent before runtime calls", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("agent")

    const missingIntent = await tools.callTool("request_runtime_restart", {
      reason: "Restart please.",
    })
    const invalidIntent = await tools.callTool("request_runtime_restart", {
      reason: "Restart please.",
      userIntent: "curiosity",
    })

    expect(missingIntent.isError).toBe(true)
    expect(invalidIntent.isError).toBe(true)
    expect(runtimeClient.requestRuntimeRestart).not.toHaveBeenCalled()
    expect(auditRecords).toEqual([
      {
        profile: "agent",
        toolName: "request_runtime_restart",
        allowed: false,
        arguments: { reason: "Restart please." },
        outcome: "denied",
        reason: "agent restart requires explicit user intent",
        error: "denied",
      },
      {
        profile: "agent",
        toolName: "request_runtime_restart",
        allowed: false,
        arguments: { reason: "Restart please.", userIntent: "curiosity" },
        outcome: "denied",
        reason: "agent restart requires explicit user intent",
        error: "denied",
      },
    ])
  })

  it("allows admin runtime restart", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("admin")

    const result = await tools.callTool("request_runtime_restart", {
      reason: "User asked for runtime restart.",
      userIntent: "explicit_user_request",
    })

    expect(result.isError).toBeUndefined()
    expect(runtimeClient.requestRuntimeRestart).toHaveBeenCalledTimes(1)
    expect(auditRecords[0]).toMatchObject({
      profile: "admin",
      toolName: "request_runtime_restart",
      allowed: true,
      runtimeUrl: "http://127.0.0.1:43217",
      outcome: "succeeded",
      reason: "admin may request runtime restart",
    })
  })

  it("prevents unknown profiles from calling tools even when called directly", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("unknown")

    const result = await tools.callTool("request_app_refresh", {
      reason: "Reload after edits.",
    })

    expect(result.isError).toBe(true)
    expect(runtimeClient.requestAppRefresh).not.toHaveBeenCalled()
    expect(auditRecords).toEqual([
      {
        profile: "unknown",
        toolName: "request_app_refresh",
        allowed: false,
        arguments: { reason: "Reload after edits." },
        outcome: "denied",
        reason: "unknown profile is not authorized",
        error: "denied",
      },
    ])
  })

  it("returns tool errors and audits failed schema validation", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("agent")

    const result = await tools.callTool("request_app_refresh", {
      reason: "",
    })

    expect(result.isError).toBe(true)
    expect(textContent(result)).toContain("Invalid request_app_refresh arguments")
    expect(runtimeClient.requestAppRefresh).not.toHaveBeenCalled()
    expect(auditRecords).toEqual([
      {
        profile: "agent",
        toolName: "request_app_refresh",
        allowed: true,
        arguments: { reason: "" },
        outcome: "failed",
        reason: "profile may request app refresh",
        error: "Invalid request_app_refresh arguments",
      },
    ])
  })

  it("returns tool errors and audits failed runtime calls", async () => {
    const { auditRecords, runtimeClient, tools } = createHarness("agent")
    runtimeClient.requestAppRefresh.mockRejectedValueOnce(new Error("connection refused"))

    const result = await tools.callTool("request_app_refresh", {
      reason: "Reload after edits.",
    })

    expect(result.isError).toBe(true)
    expect(textContent(result)).toContain("connection refused")
    expect(auditRecords).toEqual([
      {
        profile: "agent",
        toolName: "request_app_refresh",
        allowed: true,
        arguments: { reason: "Reload after edits." },
        outcome: "failed",
        reason: "profile may request app refresh",
        error: "connection refused",
      },
    ])
  })
})
