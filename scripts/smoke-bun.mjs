#!/usr/bin/env node
import { spawn } from "node:child_process"
import process from "node:process"

const PORT = 43900
const runtime = spawn("bun", ["runtime/entry.ts"], {
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
  throw new Error("runtime did not become healthy")
}

async function main() {
  try {
    await waitForHealth()
    const start = await fetch(`${base}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // fakeProvider registers under id "codex", so POST /runs must use provider:"codex"
      // (ACTIONPAD_PROVIDER="fake" selects the fake implementation; "codex" is its registered id)
      body: JSON.stringify({ provider: "codex", nodeId: "node-1", prompt: "hello", context: "" }),
    })
    if (!start.ok) throw new Error(`POST /runs failed: ${start.status}`)
    console.log("smoke-bun: OK")
  } finally {
    runtime.kill("SIGTERM")
  }
}

main().catch((error) => {
  runtime.kill("SIGTERM")
  console.error("smoke-bun: FAIL", error)
  process.exit(1)
})
