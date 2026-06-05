// @vitest-environment node
import path from "node:path"
import { describe, expect, it } from "vitest"
import { getActionpadHome, getActionpadPaths } from "./actionpadPaths.mjs"

describe("actionpad path helpers", () => {
  it("uses ACTIONPAD_HOME when provided", () => {
    expect(getActionpadHome({ ACTIONPAD_HOME: "/tmp/actionpad-test" })).toBe("/tmp/actionpad-test")
  })

  it("builds stable install paths", () => {
    const paths = getActionpadPaths({ ACTIONPAD_HOME: "/tmp/actionpad-test" })
    expect(paths.current).toBe(path.join("/tmp/actionpad-test", "current"))
    expect(paths.runtimeLog).toBe(path.join("/tmp/actionpad-test", "logs", "runtime.log"))
    expect(paths.webPid).toBe(path.join("/tmp/actionpad-test", "run", "web.pid"))
  })

  it("builds MCP process paths", () => {
    const paths = getActionpadPaths({ ACTIONPAD_HOME: "/tmp/actionpad-test" })
    expect(paths.mcpLog).toBe(path.join("/tmp/actionpad-test", "logs", "mcp.log"))
    expect(paths.mcpPid).toBe(path.join("/tmp/actionpad-test", "run", "mcp.pid"))
  })
})
