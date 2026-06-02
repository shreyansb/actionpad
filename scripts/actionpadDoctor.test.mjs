// @vitest-environment node
import { describe, expect, it } from "vitest"
import { formatDoctorResults } from "./actionpadDoctor.mjs"

describe("doctor formatting", () => {
  it("uses plain ASCII status markers", () => {
    expect(
      formatDoctorResults([
        { id: "a", label: "A", status: "pass", detail: "ok" },
        { id: "b", label: "B", status: "warn", detail: "check" },
        { id: "c", label: "C", status: "fail", detail: "broken" },
      ]),
    ).toBe(["[pass] A: ok", "[warn] B: check", "[fail] C: broken"].join("\n"))
  })
})
