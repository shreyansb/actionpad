// @vitest-environment node
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, "..")
const actionpadScript = path.join(scriptDir, "actionpad.mjs")
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
const versionLine = `Actionpad ${packageJson.version}`

function runActionpad(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [actionpadScript, ...args], options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

describe("actionpad command", () => {
  it("prints the package version for --version", async () => {
    const result = await runActionpad(["--version"])

    expect(result.stdout.trim()).toBe(versionLine)
    expect(result.stderr).toBe("")
  })

  it("prints the package version before status output", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))

    const result = await runActionpad(["status"], {
      env: { ...process.env, ACTIONPAD_HOME: home },
    })

    expect(result.stdout.split(/\r?\n/)[0]).toBe(versionLine)
    expect(result.stdout).toContain("runtime:")
    expect(result.stdout).toContain("web:")
    expect(result.stderr).toBe("")
  })
})
