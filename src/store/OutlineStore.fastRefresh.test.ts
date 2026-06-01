import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

describe("OutlineStore Fast Refresh exports", () => {
  test("keeps non-component hooks out of the provider module", () => {
    const source = readFileSync(join(process.cwd(), "src/store/OutlineStore.tsx"), "utf8")

    expect(source).not.toMatch(/export\s+function\s+useOutlineStore/)
  })
})
