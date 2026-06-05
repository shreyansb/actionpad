// @vitest-environment node
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

describe("release tarball packaging", () => {
  it("includes source files required by the packaged runtime", async () => {
    const packScript = await fs.readFile(path.join(scriptDir, "create-release-tarball.mjs"), "utf8")

    expect(packScript).toContain('    "src",')
    expect(packScript).toContain('    "public",')
    expect(packScript).toContain("actionpad-${version}.tar.gz")
  })
})
