import { createClaudeProvider } from "./claudeProvider"
import { createCodexProvider } from "./codexProvider"
import { parseRuntimeConfig } from "./codexConfig"
import { createFakeProvider } from "./fakeProvider"
import type { AgentProvider } from "./provider"
import { requestRuntimeProcessRestart } from "./runtimeRestart"
import { startRuntimeServer } from "./server"

const config = parseRuntimeConfig(process.env, process.cwd())

function createSelectedProvider(): AgentProvider {
  switch (config.provider) {
    case "codex":
      return createCodexProvider({ config: config.codex, mcp: config.mcp, workspace: config.workspace })
    case "claude":
      return createClaudeProvider({ config: config.claude, workspace: config.workspace })
    case "fake":
      return createFakeProvider()
  }
}

const provider = createSelectedProvider()
let handle = await startRuntimeServer({
  port: config.port,
  providers: [provider],
  workspace: config.workspace,
  runtimeController: {
    requestRestart: () => requestRuntimeProcessRestart({ handle }),
  },
})

console.log(`Actionpad runtime listening at ${handle.url}`)
console.log(`Actionpad provider: ${config.provider}`)
console.log(`Actionpad workspace: ${config.workspace}`)
if (config.provider === "codex") {
  console.log(
    `Actionpad Codex safety: sandbox=${config.codex.sandbox} approval=${config.codex.approval} network=${config.codex.network} webSearch=${config.codex.webSearch}`,
  )
}
if (config.provider === "claude") {
  console.log(
    `Actionpad Claude Code: executable=${config.claude.executable} permissionMode=${config.claude.permissionMode} model=${config.claude.model ?? "default"} effort=${config.claude.effort ?? "default"}`,
  )
}

async function shutdown(): Promise<void> {
  await handle.close()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
