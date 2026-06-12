import { spawn } from "node:child_process"
import { shouldRestartRuntimeProcess } from "./devAllProcess.mjs"

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const processes = []
let shuttingDown = false

function start(name, args, env = {}) {
  const child = spawn(npmCommand, args, {
    env: { ...process.env, ...env },
    stdio: ["inherit", "pipe", "pipe"],
  })

  processes.push(child)
  child.stdout.on("data", (chunk) => {
    process.stdout.write(prefixLines(name, chunk))
  })
  child.stderr.on("data", (chunk) => {
    process.stderr.write(prefixLines(name, chunk))
  })
  child.on("exit", (code, signal) => {
    const index = processes.indexOf(child)
    if (index >= 0) processes.splice(index, 1)
    if (shouldRestartRuntimeProcess({ name, code, signal, shuttingDown })) {
      start("runtime", ["run", "runtime:dev"])
      return
    }
    if (shuttingDown) return
    shuttingDown = true
    stopAll(child)
    process.exitCode = code ?? (signal ? 1 : 0)
  })

  return child
}

function prefixLines(name, chunk) {
  return chunk
    .toString()
    .split(/(\n)/)
    .map((part) => (part === "\n" || part === "" ? part : `[${name}] ${part}`))
    .join("")
}

function stopAll(except) {
  for (const child of processes) {
    if (child === except || child.killed) continue
    child.kill("SIGTERM")
  }
}

process.on("SIGINT", () => {
  shuttingDown = true
  stopAll()
})

process.on("SIGTERM", () => {
  shuttingDown = true
  stopAll()
})

start("runtime", ["run", "runtime:dev"])
start("mcp", ["run", "mcp:http"], {
  ACTIONPAD_MCP_PORT: "43218",
  ACTIONPAD_MCP_PROFILE: "admin",
  ACTIONPAD_MCP_TRANSPORT: "http",
  ACTIONPAD_RUNTIME_URL: "http://127.0.0.1:43217",
})
start("web", ["run", "dev"])
