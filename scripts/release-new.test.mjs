// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  getR2UploadPlan,
  getWranglerUploadArgs,
  normalizeReleaseVersion,
  shouldSkipR2Upload,
  updateReleaseMetadata,
} from "./release-new.mjs"

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

  it("plans uploads for the installer, latest tarball, and pinned tarball aliases", () => {
    expect(getR2UploadPlan("0.1.2")).toEqual([
      {
        bucket: "actionpad",
        file: "scripts/install.sh",
        key: "install.sh",
        object: "actionpad/install.sh",
      },
      {
        bucket: "actionpad",
        file: "release/actionpad.tar.gz",
        key: "actionpad.tar.gz",
        object: "actionpad/actionpad.tar.gz",
      },
      {
        bucket: "actionpad",
        file: "release/actionpad-0.1.2.tar.gz",
        key: "actionpad-0.1.2.tar.gz",
        object: "actionpad/actionpad-0.1.2.tar.gz",
      },
      {
        bucket: "actionpad",
        file: "release/actionpad-0.1.2.tar.gz",
        key: "actionpad-v0.1.2.tar.gz",
        object: "actionpad/actionpad-v0.1.2.tar.gz",
      },
    ])
  })

  it("builds wrangler r2 object upload arguments", () => {
    expect(
      getWranglerUploadArgs({
        object: "actionpad/actionpad.tar.gz",
        file: "release/actionpad.tar.gz",
      }),
    ).toEqual([
      "r2",
      "object",
      "put",
      "actionpad/actionpad.tar.gz",
      "--file",
      "release/actionpad.tar.gz",
      "--remote",
    ])
  })

  it("allows the R2 upload to be skipped explicitly", () => {
    expect(shouldSkipR2Upload({ ACTIONPAD_R2_UPLOAD: "0" })).toBe(true)
    expect(shouldSkipR2Upload({ ACTIONPAD_R2_UPLOAD: "false" })).toBe(true)
    expect(shouldSkipR2Upload({})).toBe(false)
  })
})
