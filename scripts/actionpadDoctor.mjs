import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { getActionpadPaths } from "./actionpadPaths.mjs"
import { getActionpadDefaultConfig } from "./actionpadDefaults.mjs"
import { isPortFree, readPidFile, waitForHttpOk, getPortOwnerHint } from "./actionpadProcess.mjs"

function result(id, label, status, detail) {
  return { id, label, status, detail }
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function checkHttp(url, timeoutMs = 500) {
  try {
    await waitForHttpOk(url, { timeoutMs, intervalMs: 100 })
    return true
  } catch {
    return false
  }
}

async function checkPort({ id, label, port, host, healthUrl, pidFile }) {
  const healthy = await checkHttp(healthUrl)
  if (healthy) return result(id, label, "pass", `${healthUrl} is healthy.`)

  const pid = await readPidFile(pidFile)
  if (pid) {
    return result(id, label, "fail", `PID ${pid} exists, but ${healthUrl} did not respond.`)
  }

  if (await isPortFree(port, host)) {
    return result(id, label, "pass", `Port ${port} is available.`)
  }

  const owner = await getPortOwnerHint(port)
  return result(id, label, "fail", `Port ${port} is already in use by another process (${owner}).`)
}

async function checkDeepCodexSmoke(currentDir) {
  try {
    const sdkEntry = path.join(currentDir, "node_modules", "@openai", "codex-sdk", "dist", "index.js")
    const { Codex } = await import(pathToFileURL(sdkEntry).href)
    const codex = new Codex()
    const thread = codex.startThread({ workingDirectory: currentDir, skipGitRepoCheck: true })
    const turn = await thread.run("Reply with exactly: actionpad doctor ok")
    const reply = String(turn.finalResponse ?? "").trim()
    if (reply === "actionpad doctor ok") {
      return result("codex-smoke", "Codex SDK smoke", "pass", "Codex SDK completed the deep smoke check.")
    }
    return result("codex-smoke", "Codex SDK smoke", "fail", `Unexpected Codex response: ${reply || "(empty)"}`)
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "Codex SDK smoke check failed."
    return result("codex-smoke", "Codex SDK smoke", "fail", message)
  }
}

export async function runDoctorChecks(options = {}) {
  const env = options.env ?? process.env
  const defaults = getActionpadDefaultConfig()
  const paths = options.paths ?? getActionpadPaths(env)
  const host = env.ACTIONPAD_HOST || defaults.ACTIONPAD_HOST
  const runtimePort = Number(env.ACTIONPAD_RUNTIME_PORT ?? defaults.ACTIONPAD_RUNTIME_PORT)
  const webPort = Number(env.ACTIONPAD_WEB_PORT ?? defaults.ACTIONPAD_WEB_PORT)
  const currentDir = options.currentDir ?? paths.current
  const results = []

  results.push(
    process.platform === "darwin"
      ? result("platform", "Platform", "pass", "macOS detected.")
      : result("platform", "Platform", "warn", "This release is tested on macOS first."),
  )

  const nodeMajor = Number(process.versions.node.split(".")[0])
  results.push(
    nodeMajor >= 20
      ? result("node", "Node.js", "pass", `Node ${process.versions.node}.`)
      : result("node", "Node.js", "fail", `Node 20 or newer is required; found ${process.versions.node}.`),
  )

  try {
    const npmVersion = await execFileText("npm", ["--version"])
    results.push(result("npm", "npm", "pass", `npm ${npmVersion}.`))
  } catch (error) {
    results.push(result("npm", "npm", "fail", error instanceof Error ? error.message : "npm is not available."))
  }

  const packageJson = path.join(currentDir, "package.json")
  results.push(
    (await pathExists(packageJson))
      ? result("install-package", "Install package", "pass", `${packageJson} exists.`)
      : result("install-package", "Install package", "fail", `${packageJson} is missing.`),
  )

  const sdkDir = path.join(currentDir, "node_modules", "@openai", "codex-sdk")
  results.push(
    (await pathExists(sdkDir))
      ? result("codex-sdk-files", "Codex SDK files", "pass", "@openai/codex-sdk is installed.")
      : result("codex-sdk-files", "Codex SDK files", "fail", "@openai/codex-sdk is missing from node_modules."),
  )

  try {
    await import(pathToFileURL(path.join(sdkDir, "dist", "index.js")).href)
    let bundled = false
    const require = createRequire(packageJson)
    try {
      require.resolve("@openai/codex/package.json")
      bundled = true
    } catch {
      try {
        require.resolve("@openai/codex-darwin-arm64/package.json")
        bundled = true
      } catch {
        bundled = false
      }
    }
    results.push(
      bundled
        ? result("codex-bundled", "Bundled Codex package", "pass", "Codex is available through installed npm packages.")
        : result("codex-bundled", "Bundled Codex package", "warn", "Codex SDK is installed, but no bundled Codex package was resolved."),
    )
  } catch (error) {
    results.push(result("codex-bundled", "Bundled Codex package", "fail", "Could not import @openai/codex-sdk."))
  }

  try {
    await execFileText("sh", ["-lc", "command -v codex"])
    results.push(result("codex-global", "Global Codex CLI", "pass", "Global codex command is available."))
  } catch {
    results.push(
      result(
        "codex-global",
        "Global Codex CLI",
        "warn",
        "Global codex command is not on PATH; this is okay because Actionpad uses the bundled Codex SDK package.",
      ),
    )
  }

  const codexAuth = path.join(os.homedir(), ".codex", "auth.json")
  results.push(
    (await pathExists(codexAuth)) || env.CODEX_API_KEY || env.OPENAI_API_KEY
      ? result("codex-auth", "Codex auth", "pass", "Codex auth is available.")
      : result(
          "codex-auth",
          "Codex auth",
          "warn",
          "Open Codex once or configure Codex auth before running Actionpad tasks.",
        ),
  )

  results.push(
    await checkPort({
      id: "runtime-port",
      label: "Runtime port",
      port: runtimePort,
      host,
      healthUrl: `http://${host}:${runtimePort}/health`,
      pidFile: paths.runtimePid,
    }),
  )
  results.push(
    await checkPort({
      id: "web-port",
      label: "Web port",
      port: webPort,
      host,
      healthUrl: `http://${host}:${webPort}/`,
      pidFile: paths.webPid,
    }),
  )

  const runtimeHealthy = await checkHttp(`http://${host}:${runtimePort}/health`)
  const runtimePid = await readPidFile(paths.runtimePid)
  results.push(
    runtimeHealthy
      ? result("runtime-health", "Runtime health", "pass", "Runtime /health is responding.")
      : runtimePid
        ? result("runtime-health", "Runtime health", "fail", `Runtime PID ${runtimePid} exists, but /health did not respond.`)
        : result("runtime-health", "Runtime health", "warn", "Runtime is stopped."),
  )

  try {
    await fs.promises.mkdir(paths.logs, { recursive: true })
    await fs.promises.access(paths.logs, fs.constants.W_OK)
    results.push(result("logs", "Logs", "pass", `${paths.logs} is writable.`))
  } catch (error) {
    results.push(result("logs", "Logs", "fail", `${paths.logs} is not writable.`))
  }

  if (options.deep) {
    results.push(await checkDeepCodexSmoke(currentDir))
  }

  return results
}

export function formatDoctorResults(results) {
  return results.map((item) => `[${item.status}] ${item.label}: ${item.detail}`).join("\n")
}
