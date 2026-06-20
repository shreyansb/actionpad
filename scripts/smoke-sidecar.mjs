#!/usr/bin/env node
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import process from "node:process"

const BIN = "dist-runtime/actionpad-runtime"
if (!existsSync(BIN)) {
  console.error(`smoke-sidecar: missing ${BIN} — run npm run build:sidecar first`)
  process.exit(1)
}

const PORT = 43960
const runtime = spawn(BIN, [], {
  env: {
    ...process.env,
    ACTIONPAD_PROVIDER: "fake",
    ACTIONPAD_RUNTIME_PORT: String(PORT),
    ACTIONPAD_MCP_ENABLED: "false",
  },
  stdio: ["ignore", "inherit", "inherit"],
})

const base = `http://127.0.0.1:${PORT}`

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("compiled runtime did not become healthy")
}

async function main() {
  try {
    await waitForHealth()
    console.log("smoke-sidecar: OK")
  } finally {
    runtime.kill("SIGTERM")
  }
}

main().catch((error) => {
  runtime.kill("SIGTERM")
  console.error("smoke-sidecar: FAIL", error)
  process.exit(1)
})
