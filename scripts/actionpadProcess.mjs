import { spawn, execFile } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"

export async function readPidFile(pidFile) {
  try {
    const raw = await fs.promises.readFile(pidFile, "utf8")
    const pid = Number(raw.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

export function isProcessAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

export async function removeStalePidFile(pidFile) {
  const pid = await readPidFile(pidFile)
  if (!pid) return { removed: false, pid: null }
  if (isProcessAlive(pid)) return { removed: false, pid }
  await fs.promises.rm(pidFile, { force: true })
  return { removed: true, pid }
}

export function waitForHttpOk(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 200
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, { timeout: intervalMs }, (response) => {
        response.resume()
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400) {
          resolve(true)
          return
        }
        retry()
      })
      request.on("timeout", () => {
        request.destroy()
      })
      request.on("error", retry)
    }

    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }
      setTimeout(attempt, intervalMs)
    }

    attempt()
  })
}

export async function startBackgroundProcess({ command, args = [], cwd, env, logFile, pidFile }) {
  await fs.promises.mkdir(path.dirname(logFile), { recursive: true })
  await fs.promises.mkdir(path.dirname(pidFile), { recursive: true })
  const out = fs.openSync(logFile, "a")
  const err = fs.openSync(logFile, "a")
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", out, err],
  })
  child.unref()
  if (!child.pid) {
    throw new Error(`Could not start ${command}.`)
  }
  await fs.promises.writeFile(pidFile, `${child.pid}\n`)
  return child.pid
}

export async function stopPidFileProcess(pidFile, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000
  const pollMs = options.pollMs ?? 100
  const pid = await readPidFile(pidFile)
  if (!pid) return { status: "not-running", pid: null }
  if (!isProcessAlive(pid)) {
    await fs.promises.rm(pidFile, { force: true })
    return { status: "stale-removed", pid }
  }

  process.kill(pid, "SIGTERM")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      await fs.promises.rm(pidFile, { force: true })
      return { status: "stopped", pid }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGKILL")
  }
  await fs.promises.rm(pidFile, { force: true })
  return { status: "killed", pid }
}

export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

export function getPortOwnerHint(port) {
  return new Promise((resolve) => {
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(`port ${port}`)
        return
      }
      resolve(stdout.trim().split("\n").slice(0, 3).join("; "))
    })
  })
}
