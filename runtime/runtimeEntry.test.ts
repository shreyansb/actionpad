import { describe, expect, it } from "vitest"
import { startRuntimeFromEnv } from "./main"

describe("startRuntimeFromEnv", () => {
  it("starts a runtime with the fake provider and closes it", async () => {
    const handle = await startRuntimeFromEnv({
      ACTIONPAD_PROVIDER: "fake",
      ACTIONPAD_RUNTIME_PORT: "43950",
      ACTIONPAD_MCP_ENABLED: "false",
    })
    try {
      const res = await fetch(`${handle.url}/health`)
      expect(res.ok).toBe(true)
    } finally {
      await handle.close()
    }
  })
})
