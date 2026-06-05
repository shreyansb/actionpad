import type { ActionpadMcpConfig, ActionpadMcpProfile, ActionpadMcpTransport } from "./types"

type Env = Record<string, string | undefined>

const defaultRuntimeUrl = "http://127.0.0.1:43217"
const defaultProfile: ActionpadMcpProfile = "agent"
const defaultTransport: ActionpadMcpTransport = "stdio"
const defaultHttpHost = "127.0.0.1"
const defaultHttpPort = 43218
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"])

function readEnv(env: Env, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

function parseRuntimeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol")
    }
    return value
  } catch {
    throw new Error("ACTIONPAD_RUNTIME_URL must be a valid http or https URL.")
  }
}

function parseProfile(value: string | undefined): ActionpadMcpProfile {
  if (!value) return defaultProfile
  if (value === "agent" || value === "admin") return value
  return "unknown"
}

function parseTransport(value: string | undefined): ActionpadMcpTransport {
  if (!value) return defaultTransport
  if (value === "stdio" || value === "http") return value
  throw new Error("ACTIONPAD_MCP_TRANSPORT must be stdio or http.")
}

function parsePort(value: string | undefined): number {
  if (!value) return defaultHttpPort
  if (!/^\d+$/.test(value)) {
    throw new Error("ACTIONPAD_MCP_PORT must be an integer from 1 to 65535.")
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ACTIONPAD_MCP_PORT must be an integer from 1 to 65535.")
  }
  return port
}

function parseHttpHost(value: string | undefined): string {
  if (!value) return defaultHttpHost
  if (loopbackHosts.has(value)) return value
  throw new Error("ACTIONPAD_MCP_HOST must be a loopback host.")
}

export function parseActionpadMcpConfig(env: Env = process.env): ActionpadMcpConfig {
  const runtimeUrl = parseRuntimeUrl(readEnv(env, "ACTIONPAD_RUNTIME_URL") ?? defaultRuntimeUrl)

  return {
    runtimeUrl,
    profile: parseProfile(readEnv(env, "ACTIONPAD_MCP_PROFILE")),
    auditLogPath: readEnv(env, "ACTIONPAD_MCP_AUDIT_LOG"),
    transport: parseTransport(readEnv(env, "ACTIONPAD_MCP_TRANSPORT")),
    http: {
      host: parseHttpHost(readEnv(env, "ACTIONPAD_MCP_HOST")),
      port: parsePort(readEnv(env, "ACTIONPAD_MCP_PORT")),
    },
  }
}
