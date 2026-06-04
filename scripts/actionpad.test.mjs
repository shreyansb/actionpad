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

  it("updates by running the installed latest-release installer", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))
    const installBin = path.join(home, "bin")
    const installerLog = path.join(home, "installer-env.json")
    const installer = path.join(home, "current", "scripts", "install.sh")
    await fs.mkdir(path.dirname(installer), { recursive: true })
    await fs.writeFile(
      installer,
      [
        "#!/usr/bin/env bash",
        "printf '{\"ACTIONPAD_HOME\":\"%s\",\"ACTIONPAD_INSTALL_BIN\":\"%s\",\"ACTIONPAD_VERSION\":\"%s\"}\\n' \"$ACTIONPAD_HOME\" \"$ACTIONPAD_INSTALL_BIN\" \"$ACTIONPAD_VERSION\" > \"$ACTIONPAD_TEST_INSTALLER_LOG\"",
      ].join("\n"),
      { mode: 0o755 },
    )
    await fs.chmod(installer, 0o755)

    const result = await runActionpad(["update"], {
      env: {
        ...process.env,
        ACTIONPAD_HOME: home,
        ACTIONPAD_INSTALL_BIN: installBin,
        ACTIONPAD_TEST_INSTALLER_LOG: installerLog,
      },
    })

    await expect(fs.readFile(installerLog, "utf8").then(JSON.parse)).resolves.toEqual({
      ACTIONPAD_HOME: home,
      ACTIONPAD_INSTALL_BIN: installBin,
      ACTIONPAD_VERSION: "latest",
    })
    expect(result.stdout.split(/\r?\n/)[0]).toBe(versionLine)
    expect(result.stdout).toContain("Updating Actionpad...")
    expect(result.stderr).toBe("")
  })
})
