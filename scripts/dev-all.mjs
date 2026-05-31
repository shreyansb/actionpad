import { spawn } from "node:child_process"

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const processes = []
let shuttingDown = false

function start(name, args) {
  const child = spawn(npmCommand, args, {
    env: process.env,
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

start("web", ["run", "dev"])
start("runtime", ["run", "runtime:dev"])
