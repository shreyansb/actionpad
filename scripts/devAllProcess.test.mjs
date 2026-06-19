// @vitest-environment node
import { describe, expect, it } from "vitest"
import { RUNTIME_RESTART_EXIT_CODE, shouldRestartRuntimeProcess } from "./devAllProcess.mjs"

describe("dev-all process supervision", () => {
  it("restarts only runtime exits that use the runtime restart code", () => {
    expect(
      shouldRestartRuntimeProcess({
        name: "runtime",
        code: RUNTIME_RESTART_EXIT_CODE,
        signal: null,
        shuttingDown: false,
      }),
    ).toBe(true)

    expect(
      shouldRestartRuntimeProcess({
        name: "web",
        code: RUNTIME_RESTART_EXIT_CODE,
        signal: null,
        shuttingDown: false,
      }),
    ).toBe(false)
    expect(
      shouldRestartRuntimeProcess({
        name: "runtime",
        code: 1,
        signal: null,
        shuttingDown: false,
      }),
    ).toBe(false)
    expect(
      shouldRestartRuntimeProcess({
        name: "runtime",
        code: RUNTIME_RESTART_EXIT_CODE,
        signal: "SIGTERM",
        shuttingDown: false,
      }),
    ).toBe(false)
    expect(
      shouldRestartRuntimeProcess({
        name: "runtime",
        code: RUNTIME_RESTART_EXIT_CODE,
        signal: null,
        shuttingDown: true,
      }),
    ).toBe(false)
  })
})
