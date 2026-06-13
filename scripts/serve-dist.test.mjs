// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildActionpadConfigScript,
  getDefaultServeOptions,
  getMimeType,
  getServeTarget,
  resolveDistPath,
} from "./serve-dist.mjs"

let tempDir

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "actionpad-serve-"))
  await fs.promises.writeFile(path.join(tempDir, "index.html"), "<html></html>")
})

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true })
})

describe("serve-dist helpers", () => {
  it("returns expected MIME types", () => {
    expect(getMimeType("index.html")).toBe("text/html; charset=utf-8")
    expect(getMimeType("app.js")).toBe("text/javascript; charset=utf-8")
    expect(getMimeType("style.css")).toBe("text/css; charset=utf-8")
    expect(getMimeType("font.woff2")).toBe("font/woff2")
  })

  it("prevents traversal outside dist", () => {
    expect(resolveDistPath(tempDir, "/../package.json")).toBeNull()
  })

  it("falls back to index.html for extensionless missing SPA paths", async () => {
    await expect(getServeTarget(tempDir, "/outline/node-1")).resolves.toBe(path.join(tempDir, "index.html"))
  })

  it("defaults packaged serving to the installed web port", () => {
    expect(getDefaultServeOptions({})).toEqual({ host: "127.0.0.1", port: 5110 })
  })

  it("builds packaged provider config from environment", () => {
    expect(buildActionpadConfigScript({ ACTIONPAD_PROVIDER: "claude" })).toContain('"provider":"claude"')
    expect(buildActionpadConfigScript({ ACTIONPAD_PROVIDER: "missing" })).toContain('"provider":"codex"')
  })
})
