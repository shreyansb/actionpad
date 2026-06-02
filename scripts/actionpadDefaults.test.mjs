// @vitest-environment node
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getActionpadDefaultConfig, getActionpadDevPorts } from "./actionpadDefaults.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

describe("Actionpad packaged defaults", () => {
  it("uses packaged ports that do not collide with local dev ports", () => {
    const defaults = getActionpadDefaultConfig()
    const devPorts = getActionpadDevPorts()

    expect(defaults.ACTIONPAD_RUNTIME_PORT).toBe("5111")
    expect(defaults.ACTIONPAD_WEB_PORT).toBe("5110")
    expect(defaults.ACTIONPAD_RUNTIME_PORT).not.toBe(String(devPorts.runtimePort))
    expect(defaults.ACTIONPAD_WEB_PORT).not.toBe(String(devPorts.webPort))
  })

  it("keeps the installer config template on the packaged ports", async () => {
    const installScript = await fs.readFile(path.join(scriptDir, "install.sh"), "utf8")

    expect(installScript).toContain('ACTIONPAD_WEB_PORT="${ACTIONPAD_WEB_PORT:-5110}"')
    expect(installScript).toContain('ACTIONPAD_RUNTIME_PORT="${ACTIONPAD_RUNTIME_PORT:-5111}"')
  })

  it("defaults installer downloads to the Actionpad static host", async () => {
    const installScript = await fs.readFile(path.join(scriptDir, "install.sh"), "utf8")

    expect(installScript).toContain('ACTIONPAD_RELEASE_BASE_URL="${ACTIONPAD_RELEASE_BASE_URL:-https://actionpad.theolabs.org}"')
    expect(installScript).toContain('tarball_url="$base_url/actionpad.tar.gz"')
    expect(installScript).toContain('tarball_url="$base_url/actionpad-$ACTIONPAD_VERSION.tar.gz"')
    expect(installScript).toContain('ACTIONPAD_TARBALL_URL="${ACTIONPAD_TARBALL_URL:-}"')
  })
})
