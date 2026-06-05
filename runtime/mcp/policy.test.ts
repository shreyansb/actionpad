// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  authorizeActionpadMcpCall,
  getVisibleActionpadMcpTools,
  type RuntimeRestartUserIntent,
} from "./policy"

describe("Actionpad MCP policy", () => {
  it("shows refresh and restart tools to agent and admin profiles", () => {
    expect(getVisibleActionpadMcpTools("agent")).toEqual([
      "request_app_refresh",
      "request_runtime_restart",
    ])
    expect(getVisibleActionpadMcpTools("admin")).toEqual([
      "request_app_refresh",
      "request_runtime_restart",
    ])
  })

  it("hides all tools for unknown profiles", () => {
    expect(getVisibleActionpadMcpTools("unknown")).toEqual([])
  })

  it("allows app refresh for agent and admin only", () => {
    expect(authorizeActionpadMcpCall("agent", "request_app_refresh", {})).toEqual({
      allowed: true,
      reason: "profile may request app refresh",
    })
    expect(authorizeActionpadMcpCall("admin", "request_app_refresh", {})).toEqual({
      allowed: true,
      reason: "profile may request app refresh",
    })
    expect(authorizeActionpadMcpCall("unknown", "request_app_refresh", {})).toEqual({
      allowed: false,
      reason: "unknown profile is not authorized",
    })
  })

  it("allows runtime restart for admin", () => {
    expect(authorizeActionpadMcpCall("admin", "request_runtime_restart", {})).toEqual({
      allowed: true,
      reason: "admin may request runtime restart",
    })
  })

  it("allows agent runtime restart only for approved user intent values", () => {
    const allowedIntents: RuntimeRestartUserIntent[] = [
      "explicit_user_request",
      "runtime_changes_need_reload",
    ]

    for (const userIntent of allowedIntents) {
      expect(authorizeActionpadMcpCall("agent", "request_runtime_restart", { userIntent })).toEqual({
        allowed: true,
        reason: "agent restart intent is allowed",
      })
    }

    expect(authorizeActionpadMcpCall("agent", "request_runtime_restart", {})).toEqual({
      allowed: false,
      reason: "agent restart requires explicit user intent",
    })
    expect(
      authorizeActionpadMcpCall("agent", "request_runtime_restart", {
        userIntent: "curiosity",
      }),
    ).toEqual({
      allowed: false,
      reason: "agent restart requires explicit user intent",
    })
  })

  it("fails closed for unknown profiles and unknown tool names", () => {
    expect(authorizeActionpadMcpCall("unknown", "request_runtime_restart", {})).toEqual({
      allowed: false,
      reason: "unknown profile is not authorized",
    })
    expect(authorizeActionpadMcpCall("admin", "delete_everything", {})).toEqual({
      allowed: false,
      reason: "unknown tool is not authorized",
    })
  })
})
