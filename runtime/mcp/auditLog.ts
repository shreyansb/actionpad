import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { ActionpadMcpAuditRecord } from "./types"

type ActionpadMcpAuditLoggerOptions = {
  auditLogPath?: string
  now?: () => Date
}

type ActionpadMcpAuditLogger = {
  record(record: ActionpadMcpAuditRecord): Promise<void>
}

export function createActionpadMcpAuditLogger(
  options: ActionpadMcpAuditLoggerOptions = {},
): ActionpadMcpAuditLogger {
  const now = options.now ?? (() => new Date())

  return {
    async record(record: ActionpadMcpAuditRecord): Promise<void> {
      const line = JSON.stringify({
        timestamp: record.timestamp ?? now().toISOString(),
        profile: record.profile,
        toolName: record.toolName,
        allowed: record.allowed,
        ...(record.arguments ? { arguments: record.arguments } : {}),
        ...(record.runtimeUrl ? { runtimeUrl: record.runtimeUrl } : {}),
        ...(record.outcome ? { outcome: record.outcome } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
        ...(record.error ? { error: record.error } : {}),
      })

      if (options.auditLogPath) {
        await mkdir(dirname(options.auditLogPath), { recursive: true })
        await appendFile(options.auditLogPath, `${line}\n`, "utf8")
        return
      }

      console.error(line)
    },
  }
}
