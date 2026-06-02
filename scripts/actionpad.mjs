#!/usr/bin/env node
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getActionpadPaths, displayHomeRelative } from "./actionpadPaths.mjs"
import { getActionpadDefaultConfig } from "./actionpadDefaults.mjs"
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

function usage() {
  return [
    "Usage: actionpad [start|stop|restart|open|status|doctor]",
    "       actionpad start [--open]",
    "       actionpad doctor [--deep]",
  ].join("\n")
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

function webUrl(config) {
  return `http://${config.ACTIONPAD_HOST}:${config.ACTIONPAD_WEB_PORT}`
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
  printRunning(config, paths)
  if (open) await openActionpad({ skipStatus: true })
}

async function stopActionpad() {
  const paths = getActionpadPaths()
  const web = await stopPidFileProcess(paths.webPid)
  const runtime = await stopPidFileProcess(paths.runtimePid)
  for (const [name, item] of [
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
  console.log(`runtime: ${runtimePid ? `PID ${runtimePid}` : "not running"}; health ${await healthOk(runtimeUrl(config)) ? "ok" : "not responding"}`)
  console.log(`web:     ${webPid ? `PID ${webPid}` : "not running"}; health ${await healthOk(webUrl(config)) ? "ok" : "not responding"}`)
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

async function main(argv) {
  const [command = "start", ...args] = argv
  if (command === "start") return startActionpad({ open: args.includes("--open") })
  if (command === "stop") return stopActionpad()
  if (command === "restart") {
    await stopActionpad()
    return startActionpad({ open: args.includes("--open") })
  }
  if (command === "open") return openActionpad()
  if (command === "status") return statusActionpad()
  if (command === "doctor") return doctorActionpad(args)
  if (command === "--help" || command === "-h") {
    console.log(usage())
    return
  }
  console.error(usage())
  process.exitCode = 1
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
