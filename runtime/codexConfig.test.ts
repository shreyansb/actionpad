// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parseRuntimeConfig } from "./codexConfig"

describe("codexConfig", () => {
  it("defaults to Codex provider and conservative Codex settings", () => {
    const config = parseRuntimeConfig({}, "/repo/actionpad")

    expect(config).toEqual({
      provider: "codex",
      port: 5111,
      workspace: "/repo/actionpad",
      codex: {
        model: undefined,
        reasoning: undefined,
        sandbox: "workspace-write",
        approval: "on-request",
        network: false,
        webSearch: "disabled",
      },
      claude: {
        executable: "claude",
        model: undefined,
        effort: undefined,
        permissionMode: "default",
        allowedTools: [],
        disallowedTools: [],
      },
      mcp: {
        enabled: true,
        profile: "agent",
        runtimeUrl: "http://127.0.0.1:5111",
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
        ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:65432",
        ACTIONPAD_MCP_ENABLED: "false",
        ACTIONPAD_MCP_PROFILE: "admin",
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
    expect(config.claude).toEqual({
      executable: "claude",
      model: undefined,
      effort: undefined,
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: [],
    })
    expect(config.mcp).toEqual({
      enabled: false,
      profile: "admin",
      runtimeUrl: "http://127.0.0.1:65432",
    })
  })

  it("falls back to the agent MCP profile for non-admin values", () => {
    const config = parseRuntimeConfig(
      {
        ACTIONPAD_RUNTIME_PORT: "43217",
        ACTIONPAD_MCP_PROFILE: "owner",
      },
      "/repo/actionpad",
    )

    expect(config.mcp).toEqual({
      enabled: true,
      profile: "agent",
      runtimeUrl: "http://127.0.0.1:43217",
    })
  })

  it("rejects invalid provider and safety settings", () => {
    expect(() => parseRuntimeConfig({ ACTIONPAD_PROVIDER: "remote" }, "/repo")).toThrow(
      "ACTIONPAD_PROVIDER must be fake, codex, or claude.",
    )
    expect(() => parseRuntimeConfig({ ACTIONPAD_CODEX_SANDBOX: "root" }, "/repo")).toThrow(
      "ACTIONPAD_CODEX_SANDBOX must be read-only, workspace-write, or danger-full-access.",
    )
    expect(() => parseRuntimeConfig({ ACTIONPAD_CODEX_APPROVAL: "always" }, "/repo")).toThrow(
      "ACTIONPAD_CODEX_APPROVAL must be never, on-request, on-failure, or untrusted.",
    )
  })

  it("parses explicit Claude runtime configuration", () => {
    const config = parseRuntimeConfig(
      {
        ACTIONPAD_PROVIDER: "claude",
        ACTIONPAD_CLAUDE_EXECUTABLE: "/usr/local/bin/claude",
        ACTIONPAD_CLAUDE_MODEL: "sonnet",
        ACTIONPAD_CLAUDE_EFFORT: "high",
        ACTIONPAD_CLAUDE_PERMISSION_MODE: "acceptEdits",
        ACTIONPAD_CLAUDE_ALLOWED_TOOLS: "Read,Edit,Bash(git *)",
        ACTIONPAD_CLAUDE_DISALLOWED_TOOLS: "WebFetch,WebSearch",
      },
      "/repo/actionpad",
    )

    expect(config.provider).toBe("claude")
    expect(config.claude).toEqual({
      executable: "/usr/local/bin/claude",
      model: "sonnet",
      effort: "high",
      permissionMode: "acceptEdits",
      allowedTools: ["Read", "Edit", "Bash(git *)"],
      disallowedTools: ["WebFetch", "WebSearch"],
    })
  })

  it("rejects unsupported Claude settings", () => {
    expect(() =>
      parseRuntimeConfig({ ACTIONPAD_PROVIDER: "claude", ACTIONPAD_CLAUDE_EFFORT: "huge" }, "/repo"),
    ).toThrow("ACTIONPAD_CLAUDE_EFFORT must be low, medium, high, xhigh, or max.")

    expect(() =>
      parseRuntimeConfig(
        { ACTIONPAD_PROVIDER: "claude", ACTIONPAD_CLAUDE_PERMISSION_MODE: "root" },
        "/repo",
      ),
    ).toThrow(
      "ACTIONPAD_CLAUDE_PERMISSION_MODE must be acceptEdits, auto, bypassPermissions, default, dontAsk, or plan.",
    )
  })
})
