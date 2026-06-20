import { describe, expect, it } from "vitest"
import { isCompiledRuntime } from "./isCompiledRuntime"

describe("isCompiledRuntime", () => {
  it("returns false for node and bun hosts", () => {
    expect(isCompiledRuntime("/usr/local/bin/node")).toBe(false)
    expect(isCompiledRuntime("/Users/me/.bun/bin/bun")).toBe(false)
    expect(isCompiledRuntime("C:\\Program Files\\nodejs\\node.exe")).toBe(false)
  })

  it("returns true for a compiled binary name", () => {
    expect(isCompiledRuntime("/Applications/Actionpad.app/Contents/Resources/actionpad-runtime")).toBe(true)
    expect(isCompiledRuntime("/opt/actionpad-runtime")).toBe(true)
  })
})
