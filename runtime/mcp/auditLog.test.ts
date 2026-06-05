// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createActionpadMcpAuditLogger } from "./auditLog"

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
  vi.restoreAllMocks()
})

describe("Actionpad MCP audit log", () => {
  it("writes JSON-line records to a configured file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "actionpad-mcp-audit-"))
    const logPath = join(tempDir, "audit.jsonl")
    const logger = createActionpadMcpAuditLogger({
      auditLogPath: logPath,
      now: () => new Date("2026-06-05T12:00:00.000Z"),
    })

    await logger.record({
      profile: "agent",
      toolName: "request_app_refresh",
      allowed: true,
      arguments: { reason: "Reload the app after UI changes." },
      runtimeUrl: "http://127.0.0.1:43217",
      outcome: "succeeded",
      reason: "profile may request app refresh",
    })

    const lines = (await readFile(logPath, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-06-05T12:00:00.000Z",
      profile: "agent",
      toolName: "request_app_refresh",
      allowed: true,
      arguments: { reason: "Reload the app after UI changes." },
      runtimeUrl: "http://127.0.0.1:43217",
      outcome: "succeeded",
      reason: "profile may request app refresh",
    })
  })

  it("creates the audit log parent directory when needed", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "actionpad-mcp-audit-"))
    const logPath = join(tempDir, "logs", "mcp", "audit.jsonl")
    const logger = createActionpadMcpAuditLogger({
      auditLogPath: logPath,
      now: () => new Date("2026-06-05T12:00:00.000Z"),
    })

    await logger.record({
      profile: "admin",
      toolName: "request_runtime_restart",
      allowed: true,
    })

    expect(await readFile(logPath, "utf8")).toContain('"toolName":"request_runtime_restart"')
  })

  it("writes JSON-line records to stderr when no file is configured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const logger = createActionpadMcpAuditLogger({
      now: () => new Date("2026-06-05T12:00:00.000Z"),
    })

    await logger.record({
      profile: "unknown",
      toolName: "request_runtime_restart",
      allowed: false,
      reason: "unknown profile is not authorized",
      error: "denied",
    })

    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        timestamp: "2026-06-05T12:00:00.000Z",
        profile: "unknown",
        toolName: "request_runtime_restart",
        allowed: false,
        reason: "unknown profile is not authorized",
        error: "denied",
      }),
    )
  })
})
