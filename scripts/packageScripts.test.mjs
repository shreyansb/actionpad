// @vitest-environment node
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, "..")

describe("package scripts", () => {

  it("runs the runtime through the unified Bun entry", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))

    expect(packageJson.scripts["runtime:dev"]).toBe("ACTIONPAD_RUNTIME_PORT=43217 bun runtime/entry.ts")
    expect(packageJson.scripts["runtime:start"]).toBe("bun runtime/entry.ts")
    expect(packageJson.scripts["mcp:start"]).toBe("bun runtime/entry.ts --mcp-stdio")
    expect(packageJson.scripts["mcp:http"]).toContain("bun runtime/entry.ts --mcp-http")
  })
})
