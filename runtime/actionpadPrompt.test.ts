// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { StartRunRequest } from "../src/domain/runtimeProtocol"
import { buildActionpadPrompt } from "./actionpadPrompt"

const request: StartRunRequest = {
  provider: "codex",
  nodeId: "research-products",
  prompt: "Create two child bullets.",
  context: "Actionpad Prototype\nResearch\nCreate two child bullets.",
}

describe("actionpadPrompt", () => {
  it("includes outline patch instructions and preserves mode-specific guidance", () => {
    const initialPrompt = buildActionpadPrompt(request, "initial")
    const followUpPrompt = buildActionpadPrompt(request, "follow-up")

    expect(initialPrompt).toContain("<actionpad-outline-output>")
    expect(initialPrompt).toContain('"type": "append-child-bullets"')
    expect(initialPrompt).toContain('"type": "update-bullet-text"')
    expect(initialPrompt).toContain('"type": "delete-bullets"')
    expect(initialPrompt).toContain('"type": "batch"')
    expect(initialPrompt).toContain('"outcome": "succeeded"')
    expect(initialPrompt).toContain("For a new execution, usually append child bullets")
    expect(followUpPrompt).toContain("For a follow-up, modify the existing outline")
    expect(followUpPrompt).toContain("Executing bullet id: research-products")
    expect(followUpPrompt).toContain("Executing bullet text: Create two child bullets.")
    expect(followUpPrompt).toContain("Ancestor bullets:\n\nActionpad Prototype")
  })

  it("includes Actionpad runtime tool guidance without shell restart instructions", () => {
    const prompt = buildActionpadPrompt(request, "initial")

    expect(prompt).toContain("request_app_refresh")
    expect(prompt).toContain("request_runtime_restart")
    expect(prompt).toContain("Prefer request_app_refresh when a browser refresh is enough.")
    expect(prompt).toContain(
      "If you changed Actionpad web app code under src/, call request_app_refresh after finishing so the running app picks up the change.",
    )
    expect(prompt).toContain(
      "If you changed Actionpad runtime, provider, server, script, or MCP code under runtime/ or scripts/, call request_runtime_restart after finishing.",
    )
    expect(prompt).toContain(
      'Both runtime tools require a short "reason" string argument explaining why you are calling them.',
    )
    expect(prompt).toContain("Do not use shell commands to stop or restart Actionpad.")
    expect(prompt).toContain(
      "Only use request_runtime_restart when the user explicitly asks for a restart or when runtime/tooling changes need a reload.",
    )
    expect(prompt).toContain(
      'Pass userIntent as "explicit_user_request" when the user asked for a runtime restart, or "runtime_changes_need_reload" when runtime/tooling changes need a reload.',
    )
    expect(prompt).toContain(
      "In the packaged app, request_runtime_restart is the correct restart path; if the MCP host asks for confirmation, proceed only for the allowed restart cases above.",
    )
    expect(prompt).toContain(
      "If the MCP host reports that the tool call was cancelled, report that cancellation instead of treating it as a runtime restart failure.",
    )
    expect(prompt).toContain(
      "In development, use the same runtime tools when available and only report dev-specific runtime reachability failures from the tool result.",
    )
    expect(prompt).toContain(
      "Runtime restart requests are deferred and should not be used for ordinary browser/UI refresh needs.",
    )
    expect(prompt).not.toContain("curl -X POST")
  })
})
