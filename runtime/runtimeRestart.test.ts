// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { requestRuntimeProcessRestart, runtimeRestartExitCode } from "./runtimeRestart"

describe("runtime process restart", () => {
  it("closes the runtime server before exiting with the restart code", async () => {
    const close = vi.fn(async () => undefined)
    const exit = vi.fn()

    await requestRuntimeProcessRestart({
      handle: { close },
      exit,
      log: vi.fn(),
    })

    expect(close).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(runtimeRestartExitCode)
  })
})
