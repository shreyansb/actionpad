// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parseRuntimeConfig } from "./codexConfig"

describe("codexConfig", () => {
  it("defaults to Codex provider and conservative Codex settings", () => {
    const config = parseRuntimeConfig({}, "/repo/actionpad")

    expect(config).toEqual({
      provider: "codex",
      port: 43217,
      workspace: "/repo/actionpad",
      codex: {
        model: undefined,
        reasoning: undefined,
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
    })
  })

  it("parses explicit Codex runtime configuration", () => {
    const config = parseRuntimeConfig(
      {
        ACTIONPAD_PROVIDER: "codex",
        ACTIONPAD_RUNTIME_PORT: "54321",
        ACTIONPAD_WORKSPACE: "/tmp/project",
        ACTIONPAD_CODEX_MODEL: "gpt-5.3-codex",
        ACTIONPAD_CODEX_REASONING: "medium",
        ACTIONPAD_CODEX_SANDBOX: "read-only",
        ACTIONPAD_CODEX_APPROVAL: "never",
        ACTIONPAD_CODEX_NETWORK: "true",
        ACTIONPAD_CODEX_WEB_SEARCH: "live",
      },
      "/repo/actionpad",
    )

    expect(config.provider).toBe("codex")
    expect(config.port).toBe(54321)
    expect(config.workspace).toBe("/tmp/project")
    expect(config.codex).toEqual({
      model: "gpt-5.3-codex",
      reasoning: "medium",
      sandbox: "read-only",
      approval: "never",
      network: true,
      webSearch: "live",
    })
  })

  it("rejects invalid provider and safety settings", () => {
    expect(() => parseRuntimeConfig({ ACTIONPAD_PROVIDER: "remote" }, "/repo")).toThrow(
      "ACTIONPAD_PROVIDER must be fake or codex.",
    )
    expect(() => parseRuntimeConfig({ ACTIONPAD_CODEX_SANDBOX: "root" }, "/repo")).toThrow(
      "ACTIONPAD_CODEX_SANDBOX must be read-only, workspace-write, or danger-full-access.",
    )
    expect(() => parseRuntimeConfig({ ACTIONPAD_CODEX_APPROVAL: "always" }, "/repo")).toThrow(
      "ACTIONPAD_CODEX_APPROVAL must be never, on-request, on-failure, or untrusted.",
    )
  })
})
