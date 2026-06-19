#!/usr/bin/env node
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getActionpadPaths, displayHomeRelative } from "./actionpadPaths.mjs"
import { ACTIONPAD_PACKAGED_PORTS, getActionpadDefaultConfig } from "./actionpadDefaults.mjs"
import {
  isPortFree,
  readPidFile,
  removeStalePidFile,
  startBackgroundProcess,
  stopPidFileProcess,
  waitForHttpOk,
  getPortOwnerHint,
} from "./actionpadProcess.mjs"
import { formatDoctorResults, runDoctorChecks } from "./actionpadDoctor.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = path.resolve(scriptDir, "..")
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"))
const actionpadVersion = packageJson.version
const defaultMcpPort = String(ACTIONPAD_PACKAGED_PORTS.mcpPort)

function usage() {
  return [
    "Usage: actionpad [start|stop|restart|open|status|doctor|update|mcp|--version]",
    "       actionpad start [--open]",
    "       actionpad mcp start",
    "       actionpad mcp stop",
    "       actionpad mcp restart",
    "       actionpad mcp status",
    "       actionpad doctor [--deep]",
  ].join("\n")
}

function mcpUsage() {
  return "Usage: actionpad mcp [start|stop|restart|status]"
}

function printVersion() {
  console.log(`Actionpad ${actionpadVersion}`)
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function loadConfig(paths, cliFlags = {}) {
  const config = getActionpadDefaultConfig()

  try {
    const raw = await fs.promises.readFile(paths.config, "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const index = trimmed.indexOf("=")
      if (index <= 0) continue
      config[trimmed.slice(0, index)] = trimmed.slice(index + 1)
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("ACTIONPAD_") && value !== undefined) config[key] = value
  }
  return { ...config, ...cliFlags }
}

function runtimeUrl(config) {
  return `http://${config.ACTIONPAD_HOST}:${config.ACTIONPAD_RUNTIME_PORT}/health`
}

function runtimeServerUrl(config) {
  return `http://${config.ACTIONPAD_HOST}:${config.ACTIONPAD_RUNTIME_PORT}`
}

function webUrl(config) {
  return `http://${config.ACTIONPAD_HOST}:${config.ACTIONPAD_WEB_PORT}`
}

function mcpHost(config) {
  return config.ACTIONPAD_MCP_HOST || "127.0.0.1"
}

function mcpPort(config) {
  return config.ACTIONPAD_MCP_PORT || defaultMcpPort
}

export function mcpServerUrl(config) {
  return `http://${mcpHost(config)}:${mcpPort(config)}`
}

export function mcpHealthUrl(config) {
  return `${mcpServerUrl(config)}/health`
}

export function buildManagedMcpEnv({ baseEnv = process.env, config, paths }) {
  return {
    ...baseEnv,
    ...config,
    ACTIONPAD_HOME: paths.home,
    ACTIONPAD_MCP_TRANSPORT: "http",
    ACTIONPAD_RUNTIME_URL: runtimeServerUrl(config),
    ACTIONPAD_MCP_HOST: mcpHost(config),
    ACTIONPAD_MCP_PORT: mcpPort(config),
    ACTIONPAD_MCP_PROFILE: config.ACTIONPAD_MCP_PROFILE || "admin",
  }
}

async function healthOk(url) {
  try {
    await waitForHttpOk(url, { timeoutMs: 500, intervalMs: 100 })
    return true
  } catch {
    return false
  }
}

async function assertPortAvailable(port, host, url) {
  if (await healthOk(url)) return
  if (await isPortFree(Number(port), host)) return
  const owner = await getPortOwnerHint(port)
  throw new Error(`Port ${port} is already in use by another process (${owner}).`)
}

function printRunning(config, paths) {
  console.log("Actionpad is running:")
  console.log(`  app:     ${webUrl(config)}`)
  console.log(`  runtime: ${runtimeUrl(config)}`)
  console.log(`  mcp:     ${mcpServerUrl(config)}/mcp`)
  console.log(`  logs:    ${displayHomeRelative(paths.logs)}`)
}

async function getAppRoot(paths) {
  if (await pathExists(path.join(paths.current, "package.json"))) return paths.current
  return sourceRoot
}

async function startActionpad({ open = false } = {}) {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const appRoot = await getAppRoot(paths)
  const distIndex = path.join(appRoot, "dist", "index.html")
  if (!(await pathExists(distIndex))) {
    throw new Error("Run npm run build or reinstall Actionpad.")
  }

  await fs.promises.mkdir(paths.logs, { recursive: true })
  await fs.promises.mkdir(paths.run, { recursive: true })
  const env = { ...process.env, ...config, ACTIONPAD_HOME: paths.home }

  await removeStalePidFile(paths.runtimePid)
  await removeStalePidFile(paths.webPid)

  if (!(await healthOk(runtimeUrl(config)))) {
    await assertPortAvailable(config.ACTIONPAD_RUNTIME_PORT, config.ACTIONPAD_HOST, runtimeUrl(config))
    await startBackgroundProcess({
      command: npmCommand,
      args: ["run", "runtime:start"],
      cwd: appRoot,
      env,
      logFile: paths.runtimeLog,
      pidFile: paths.runtimePid,
    })
  }

  if (!(await healthOk(webUrl(config)))) {
    await assertPortAvailable(config.ACTIONPAD_WEB_PORT, config.ACTIONPAD_HOST, webUrl(config))
    await startBackgroundProcess({
      command: npmCommand,
      args: ["run", "web:start"],
      cwd: appRoot,
      env,
      logFile: paths.webLog,
      pidFile: paths.webPid,
    })
  }

  await waitForHttpOk(runtimeUrl(config), { timeoutMs: 10_000, intervalMs: 250 })
  await waitForHttpOk(webUrl(config), { timeoutMs: 10_000, intervalMs: 250 })
  await startMcpActionpad({ quiet: true })
  printRunning(config, paths)
  if (open) await openActionpad({ skipStatus: true })
}

async function stopActionpad() {
  const paths = getActionpadPaths()
  const mcp = await stopPidFileProcess(paths.mcpPid)
  const web = await stopPidFileProcess(paths.webPid)
  const runtime = await stopPidFileProcess(paths.runtimePid)
  for (const [name, item] of [
    ["mcp", mcp],
    ["web", web],
    ["runtime", runtime],
  ]) {
    if (item.status === "stale-removed") {
      console.log(`${name}: removed stale PID file for ${item.pid}.`)
    } else if (item.status === "not-running") {
      console.log(`${name}: not running.`)
    } else {
      console.log(`${name}: ${item.status} PID ${item.pid}.`)
    }
  }
}

async function startMcpActionpad({ quiet = false } = {}) {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const appRoot = await getAppRoot(paths)
  const env = buildManagedMcpEnv({ baseEnv: process.env, config, paths })

  await fs.promises.mkdir(paths.logs, { recursive: true })
  await fs.promises.mkdir(paths.run, { recursive: true })
  await removeStalePidFile(paths.mcpPid)

  if (!(await healthOk(mcpHealthUrl(env)))) {
    await assertPortAvailable(env.ACTIONPAD_MCP_PORT, env.ACTIONPAD_MCP_HOST, mcpHealthUrl(env))
    await startBackgroundProcess({
      command: npmCommand,
      args: ["run", "mcp:http"],
      cwd: appRoot,
      env,
      logFile: paths.mcpLog,
      pidFile: paths.mcpPid,
    })
  }

  await waitForHttpOk(mcpHealthUrl(env), { timeoutMs: 10_000, intervalMs: 250 })
  if (quiet) return
  console.log("Actionpad MCP is running:")
  console.log(`  mcp:  ${mcpServerUrl(env)}/mcp`)
  console.log(`  log:  ${displayHomeRelative(paths.mcpLog)}`)
  console.log("  status: health ok")
}

async function stopMcpActionpad() {
  const paths = getActionpadPaths()
  const item = await stopPidFileProcess(paths.mcpPid)
  if (item.status === "stale-removed") {
    console.log(`mcp: removed stale PID file for ${item.pid}.`)
  } else if (item.status === "not-running") {
    console.log("mcp: not running.")
  } else {
    console.log(`mcp: ${item.status} PID ${item.pid}.`)
  }
}

async function openActionpad({ skipStatus = false } = {}) {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const url = webUrl(config)
  if (!skipStatus && !(await healthOk(url))) {
    console.log(`${url} is not responding. Run actionpad start first.`)
    return
  }
  if (process.platform === "darwin") {
    await new Promise((resolve, reject) => {
      execFile("open", [url], (error) => (error ? reject(error) : resolve()))
    })
  } else {
    console.log(url)
  }
}

async function statusActionpad() {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const runtimePid = await readPidFile(paths.runtimePid)
  const webPid = await readPidFile(paths.webPid)
  const mcpPid = await readPidFile(paths.mcpPid)
  console.log(`runtime: ${runtimePid ? `PID ${runtimePid}` : "not running"}; health ${await healthOk(runtimeUrl(config)) ? "ok" : "not responding"}`)
  console.log(`web:     ${webPid ? `PID ${webPid}` : "not running"}; health ${await healthOk(webUrl(config)) ? "ok" : "not responding"}`)
  console.log(`mcp:     ${mcpPid ? `PID ${mcpPid}` : "not running"}; health ${await healthOk(mcpHealthUrl(config)) ? "ok" : "not responding"}`)
}

async function statusMcpActionpad() {
  const paths = getActionpadPaths()
  const config = await loadConfig(paths)
  const pid = await readPidFile(paths.mcpPid)
  console.log(`mcp:     ${pid ? `PID ${pid}` : "not running"}; health ${await healthOk(mcpHealthUrl(config)) ? "ok" : "not responding"}`)
}

async function mcpActionpad(args) {
  const [subcommand = "status"] = args
  if (subcommand === "start") return startMcpActionpad()
  if (subcommand === "stop") return stopMcpActionpad()
  if (subcommand === "restart") {
    await stopMcpActionpad()
    return startMcpActionpad()
  }
  if (subcommand === "status") return statusMcpActionpad()
  console.error(mcpUsage())
  process.exitCode = 1
}

async function doctorActionpad(args) {
  const deep = args.includes("--deep")
  const paths = getActionpadPaths()
  const appRoot = await getAppRoot(paths)
  const config = await loadConfig(paths)
  const results = await runDoctorChecks({ deep, paths, currentDir: appRoot, env: { ...process.env, ...config } })
  console.log(formatDoctorResults(results))
  if (results.some((item) => item.status === "fail")) process.exitCode = 1
}

async function getInstallerScript(paths) {
  const installedInstaller = path.join(paths.current, "scripts", "install.sh")
  if (await pathExists(installedInstaller)) return installedInstaller
  return path.join(sourceRoot, "scripts", "install.sh")
}

async function updateActionpad() {
  const paths = getActionpadPaths()
  const installer = await getInstallerScript(paths)
  console.log("Updating Actionpad...")
  await new Promise((resolve, reject) => {
    const child = spawn("bash", [installer], {
      env: {
        ...process.env,
        ACTIONPAD_HOME: paths.home,
        ACTIONPAD_VERSION: "latest",
      },
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(signal ? `Installer exited with ${signal}.` : `Installer exited with code ${code}.`))
    })
  })
}

async function main(argv) {
  const [command = "start", ...args] = argv
  if (command === "--version" || command === "-v" || command === "version") {
    printVersion()
    return
  }
  printVersion()
  if (command === "start") return startActionpad({ open: args.includes("--open") })
  if (command === "stop") return stopActionpad()
  if (command === "restart") {
    await stopActionpad()
    return startActionpad({ open: args.includes("--open") })
  }
  if (command === "open") return openActionpad()
  if (command === "status") return statusActionpad()
  if (command === "mcp") return mcpActionpad(args)
  if (command === "doctor") return doctorActionpad(args)
  if (command === "update") return updateActionpad()
  if (command === "--help" || command === "-h") {
    console.log(usage())
    return
  }
  console.error(usage())
  process.exitCode = 1
}

export function isMainModule(argvPath, modulePath = fileURLToPath(import.meta.url)) {
  if (!argvPath) return false
  try {
    return fs.realpathSync(argvPath) === fs.realpathSync(modulePath)
  } catch {
    return path.resolve(argvPath) === path.resolve(modulePath)
  }
}

if (isMainModule(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
