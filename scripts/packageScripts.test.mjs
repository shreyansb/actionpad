// @vitest-environment node
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, "..")

describe("package scripts", () => {
  it("starts long-running TypeScript entrypoints through node import hooks", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))

    expect(packageJson.scripts["mcp:start"]).toBe("node --import tsx runtime/mcp/stdioMain.ts")
    expect(packageJson.scripts["mcp:http"]).toBe(
      "ACTIONPAD_MCP_TRANSPORT=http node --import tsx runtime/mcp/httpMain.ts",
    )
    expect(packageJson.scripts["runtime:dev"]).toBe(
      "ACTIONPAD_RUNTIME_PORT=43217 node --import tsx runtime/main.ts",
    )
    expect(packageJson.scripts["runtime:start"]).toBe("node --import tsx runtime/main.ts")
  })
})
