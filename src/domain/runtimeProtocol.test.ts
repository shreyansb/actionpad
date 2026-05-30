import { describe, expect, it } from "vitest"
import { validateOutlinePatch } from "./runtimeProtocol"

describe("validateOutlinePatch", () => {
  it("accepts append-child-bullets with non-empty text", () => {
    expect(
      validateOutlinePatch({
        type: "append-child-bullets",
        parentId: "parent-1",
        bullets: [{ text: "Draft the opening move." }],
      }),
    ).toEqual({ ok: true })
  })

  it("rejects append-child-bullets with blank text", () => {
    expect(
      validateOutlinePatch({
        type: "append-child-bullets",
        parentId: "parent-1",
        bullets: [{ text: "   " }],
      }),
    ).toEqual({ ok: false, error: "Each appended bullet needs text." })
  })

  it("rejects append-child-bullets with non-object metadata", () => {
    expect(
      validateOutlinePatch({
        type: "append-child-bullets",
        parentId: "parent-1",
        bullets: [{ text: "Draft the opening move.", metadata: ["invalid"] }],
      }),
    ).toEqual({ ok: false, error: "Appended bullet metadata must be an object." })
  })

  it("rejects set-bullet-run-status with non-string activeRunId", () => {
    expect(
      validateOutlinePatch({
        type: "set-bullet-run-status",
        nodeId: "node-1",
        status: "running",
        activeRunId: 42,
      }),
    ).toEqual({ ok: false, error: "Active run id must be a string." })
  })

  it("rejects unknown patch types", () => {
    expect(validateOutlinePatch({ type: "unknown-patch" })).toEqual({
      ok: false,
      error: "Unsupported outline patch type.",
    })
  })
})
