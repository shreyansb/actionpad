import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createActionpadMcpAuditLogger } from "./auditLog"
import { createActionpadRuntimeClient } from "./runtimeClient"
import {
  createActionpadMcpTools,
  type ActionpadMcpToolDefinition,
  type ActionpadMcpToolState,
} from "./tools"
import type {
  ActionpadMcpAuditRecord,
  ActionpadMcpConfig,
  ActionpadMcpProfile,
  RequestAppRefreshResult,
  RequestRuntimeRestartResult,
} from "./types"

type ActionpadMcpAuditLogger = {
  record(record: ActionpadMcpAuditRecord): Promise<void>
}

type ActionpadRuntimeClient = {
  requestAppRefresh(): Promise<RequestAppRefreshResult>
  requestRuntimeRestart(): Promise<RequestRuntimeRestartResult>
}

export type ActionpadMcpServerOptions = {
  profile: ActionpadMcpProfile
  runtimeClient: ActionpadRuntimeClient
  auditLogger: ActionpadMcpAuditLogger
  name?: string
  version?: string
  now?: () => Date
  toolState?: ActionpadMcpToolState
}

type McpObjectJsonSchema = {
  type: "object"
  properties?: Record<string, object>
  required?: string[]
}

function toMcpJsonSchema(
  schema: unknown,
  pipeStrategy: "input" | "output",
): McpObjectJsonSchema {
  return toJsonSchemaCompat(schema as never, {
    strictUnions: true,
    pipeStrategy,
  }) as McpObjectJsonSchema
}

function toMcpTool(tool: ActionpadMcpToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toMcpJsonSchema(tool.inputSchema, "input"),
    outputSchema: toMcpJsonSchema(tool.outputSchema, "output"),
    annotations: tool.annotations,
    _meta: tool.metadata,
  }
}

export function createActionpadMcpServer(options: ActionpadMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name ?? "actionpad",
    version: options.version ?? "0.1.8",
  })
  const tools = createActionpadMcpTools({
    profile: options.profile,
    runtimeClient: options.runtimeClient,
    auditLogger: options.auditLogger,
    now: options.now,
    state: options.toolState,
  })
  const visibleTools = tools.listTools()

  server.server.registerCapabilities({
    tools: {
      listChanged: true,
    },
  })
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: visibleTools.map(toMcpTool),
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    return tools.callTool(request.params.name, request.params.arguments)
  })

  return server
}

export function createActionpadMcpServerFromConfig(
  config: ActionpadMcpConfig,
  toolState?: ActionpadMcpToolState,
): McpServer {
  return createActionpadMcpServer({
    profile: config.profile,
    runtimeClient: createActionpadRuntimeClient({
      runtimeUrl: config.runtimeUrl,
    }),
    auditLogger: createActionpadMcpAuditLogger({
      auditLogPath: config.auditLogPath,
    }),
    toolState,
  })
}
