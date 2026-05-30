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

  it("rejects unknown patch types", () => {
    expect(validateOutlinePatch({ type: "unknown-patch" })).toEqual({
      ok: false,
      error: "Unsupported outline patch type.",
    })
  })
})
