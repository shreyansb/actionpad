// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parseActionpadMcpConfig } from "./config"

describe("Actionpad MCP config", () => {
  it("uses local defaults when env is empty", () => {
    expect(parseActionpadMcpConfig({})).toEqual({
      runtimeUrl: "http://127.0.0.1:43217",
      profile: "agent",
      auditLogPath: undefined,
      transport: "stdio",
      http: {
        host: "127.0.0.1",
        port: 43218,
      },
    })
  })

  it("parses explicit env overrides", () => {
    expect(
      parseActionpadMcpConfig({
        ACTIONPAD_RUNTIME_URL: "http://localhost:9999/base/",
        ACTIONPAD_MCP_PROFILE: "admin",
        ACTIONPAD_MCP_AUDIT_LOG: "/tmp/actionpad-mcp.log",
        ACTIONPAD_MCP_TRANSPORT: "http",
        ACTIONPAD_MCP_HOST: "localhost",
        ACTIONPAD_MCP_PORT: "54321",
      }),
    ).toEqual({
      runtimeUrl: "http://localhost:9999/base/",
      profile: "admin",
      auditLogPath: "/tmp/actionpad-mcp.log",
      transport: "http",
      http: {
        host: "localhost",
        port: 54321,
      },
    })
  })

  it("treats blank optional env values as missing", () => {
    const config = parseActionpadMcpConfig({
      ACTIONPAD_MCP_AUDIT_LOG: "  ",
      ACTIONPAD_MCP_PROFILE: "",
    })

    expect(config.auditLogPath).toBeUndefined()
    expect(config.profile).toBe("agent")
  })

  it("maps unknown profile values to unknown", () => {
    expect(parseActionpadMcpConfig({ ACTIONPAD_MCP_PROFILE: "operator" }).profile).toBe("unknown")
  })

  it("rejects invalid runtime URLs", () => {
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_RUNTIME_URL: "not a url" })).toThrow(
      "ACTIONPAD_RUNTIME_URL must be a valid http or https URL.",
    )
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_RUNTIME_URL: "file:///tmp/runtime" })).toThrow(
      "ACTIONPAD_RUNTIME_URL must be a valid http or https URL.",
    )
  })

  it("rejects invalid transports and HTTP ports", () => {
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_MCP_TRANSPORT: "websocket" })).toThrow(
      "ACTIONPAD_MCP_TRANSPORT must be stdio or http.",
    )
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_MCP_PORT: "0" })).toThrow(
      "ACTIONPAD_MCP_PORT must be an integer from 1 to 65535.",
    )
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_MCP_PORT: "65536" })).toThrow(
      "ACTIONPAD_MCP_PORT must be an integer from 1 to 65535.",
    )
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_MCP_PORT: "43218.5" })).toThrow(
      "ACTIONPAD_MCP_PORT must be an integer from 1 to 65535.",
    )
  })

  it("rejects non-loopback HTTP hosts", () => {
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_MCP_HOST: "0.0.0.0" })).toThrow(
      "ACTIONPAD_MCP_HOST must be a loopback host.",
    )
    expect(() => parseActionpadMcpConfig({ ACTIONPAD_MCP_HOST: "192.168.1.10" })).toThrow(
      "ACTIONPAD_MCP_HOST must be a loopback host.",
    )
  })
})
