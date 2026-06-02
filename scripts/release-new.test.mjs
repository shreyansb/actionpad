// @vitest-environment node
import { describe, expect, it } from "vitest"
import { normalizeReleaseVersion, updateReleaseMetadata } from "./release-new.mjs"

describe("release:new helpers", () => {
  it("accepts bare or v-prefixed semver versions", () => {
    expect(normalizeReleaseVersion("0.1.2")).toBe("0.1.2")
    expect(normalizeReleaseVersion("v0.1.2")).toBe("0.1.2")
  })

  it("rejects invalid versions", () => {
    expect(() => normalizeReleaseVersion("next")).toThrow(/Invalid version/)
  })

  it("updates package and lockfile root versions together", () => {
    const { packageJson, packageLock } = updateReleaseMetadata(
      { name: "actionpad", version: "0.1.0" },
      { name: "actionpad", version: "0.1.0", packages: { "": { name: "actionpad", version: "0.1.0" } } },
      "0.1.2",
    )

    expect(packageJson.version).toBe("0.1.2")
    expect(packageLock.version).toBe("0.1.2")
    expect(packageLock.packages[""].version).toBe("0.1.2")
  })
})
