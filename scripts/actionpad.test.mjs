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
const { buildManagedMcpEnv, isMainModule, mcpHealthUrl, mcpServerUrl } = await import("./actionpad.mjs")

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
    expect(result.stdout).toContain("mcp:")
    expect(result.stderr).toBe("")
  })

  it("prints MCP commands in usage", async () => {
    const result = await runActionpad(["--help"])

    expect(result.stdout).toContain("Usage: actionpad [start|stop|restart|open|status|doctor|update|mcp|--version]")
    expect(result.stdout).toContain("actionpad mcp start")
    expect(result.stdout).toContain("actionpad mcp stop")
    expect(result.stdout).toContain("actionpad mcp restart")
    expect(result.stdout).toContain("actionpad mcp status")
    expect(result.stderr).toBe("")
  })

  it("prints MCP status", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))

    const result = await runActionpad(["mcp", "status"], {
      env: { ...process.env, ACTIONPAD_HOME: home },
    })

    expect(result.stdout.split(/\r?\n/)[0]).toBe(versionLine)
    expect(result.stdout).toContain("mcp:")
    expect(result.stdout).toContain("not running")
    expect(result.stdout).toContain("health not responding")
    expect(result.stderr).toBe("")
  })

  it("stops only MCP when MCP is not running", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))

    const result = await runActionpad(["mcp", "stop"], {
      env: { ...process.env, ACTIONPAD_HOME: home },
    })

    expect(result.stdout.split(/\r?\n/)[0]).toBe(versionLine)
    expect(result.stdout).toContain("mcp: not running.")
    expect(result.stderr).toBe("")
  })

  it("rejects unknown MCP subcommands", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))

    await expect(
      runActionpad(["mcp", "explode"], {
        env: { ...process.env, ACTIONPAD_HOME: home },
      }),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(versionLine),
      stderr: expect.stringContaining("Usage: actionpad mcp [start|stop|restart|status]"),
    })
  })

  it("builds managed MCP URLs and environment from explicit config", () => {
    const paths = {
      home: "/tmp/actionpad-test",
    }
    const config = {
      ACTIONPAD_HOST: "127.0.0.1",
      ACTIONPAD_RUNTIME_PORT: "5111",
      ACTIONPAD_MCP_PORT: "43218",
      ACTIONPAD_MCP_PROFILE: undefined,
    }

    expect(mcpServerUrl(config)).toBe("http://127.0.0.1:43218")
    expect(mcpHealthUrl(config)).toBe("http://127.0.0.1:43218/health")
    expect(buildManagedMcpEnv({ baseEnv: {}, config, paths })).toMatchObject({
      ACTIONPAD_HOME: "/tmp/actionpad-test",
      ACTIONPAD_MCP_HOST: "127.0.0.1",
      ACTIONPAD_MCP_PORT: "43218",
      ACTIONPAD_MCP_PROFILE: "admin",
      ACTIONPAD_MCP_TRANSPORT: "http",
      ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:5111",
    })
  })

  it("uses packaged MCP defaults when no explicit MCP port is configured", () => {
    const paths = {
      home: "/tmp/actionpad-test",
    }
    const config = {
      ACTIONPAD_HOST: "127.0.0.1",
      ACTIONPAD_RUNTIME_PORT: "5111",
      ACTIONPAD_MCP_PORT: undefined,
      ACTIONPAD_MCP_PROFILE: undefined,
    }

    expect(mcpServerUrl(config)).toBe("http://127.0.0.1:5112")
    expect(mcpHealthUrl(config)).toBe("http://127.0.0.1:5112/health")
    expect(buildManagedMcpEnv({ baseEnv: {}, config, paths })).toMatchObject({
      ACTIONPAD_MCP_PORT: "5112",
    })
  })

  it("keeps managed MCP host loopback when the app host is broad", () => {
    const paths = {
      home: "/tmp/actionpad-test",
    }
    const config = {
      ACTIONPAD_HOST: "0.0.0.0",
      ACTIONPAD_RUNTIME_PORT: "5111",
      ACTIONPAD_MCP_PORT: undefined,
      ACTIONPAD_MCP_PROFILE: undefined,
    }

    expect(mcpServerUrl(config)).toBe("http://127.0.0.1:5112")
    expect(buildManagedMcpEnv({ baseEnv: {}, config, paths })).toMatchObject({
      ACTIONPAD_MCP_HOST: "127.0.0.1",
      ACTIONPAD_MCP_PORT: "5112",
      ACTIONPAD_RUNTIME_URL: "http://0.0.0.0:5111",
    })
  })

  it("allows an explicit managed MCP loopback host override", () => {
    const paths = {
      home: "/tmp/actionpad-test",
    }
    const config = {
      ACTIONPAD_HOST: "0.0.0.0",
      ACTIONPAD_RUNTIME_PORT: "5111",
      ACTIONPAD_MCP_HOST: "localhost",
      ACTIONPAD_MCP_PORT: "54321",
    }

    expect(mcpServerUrl(config)).toBe("http://localhost:54321")
    expect(buildManagedMcpEnv({ baseEnv: {}, config, paths })).toMatchObject({
      ACTIONPAD_MCP_HOST: "localhost",
      ACTIONPAD_MCP_PORT: "54321",
    })
  })

  it("detects main module execution through an install symlink", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-test-"))
    const realScript = path.join(home, "versions", "1", "scripts", "actionpad.mjs")
    const linkedScript = path.join(home, "current", "scripts", "actionpad.mjs")
    await fs.mkdir(path.dirname(realScript), { recursive: true })
    await fs.writeFile(realScript, "")
    await fs.symlink(path.join(home, "versions", "1"), path.join(home, "current"))

    expect(isMainModule(linkedScript, realScript)).toBe(true)
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
