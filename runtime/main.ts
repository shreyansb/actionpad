import { createCodexProvider } from "./codexProvider"
import { parseRuntimeConfig } from "./codexConfig"
import { createFakeProvider } from "./fakeProvider"
import { startRuntimeServer } from "./server"

const config = parseRuntimeConfig(process.env, process.cwd())
const provider =
  config.provider === "codex"
    ? createCodexProvider({ config: config.codex, mcp: config.mcp, workspace: config.workspace })
    : createFakeProvider()
const handle = await startRuntimeServer({
  port: config.port,
  providers: [provider],
  workspace: config.workspace,
})

console.log(`Actionpad runtime listening at ${handle.url}`)
console.log(`Actionpad provider: ${config.provider}`)
console.log(`Actionpad workspace: ${config.workspace}`)
console.log(
  `Actionpad Codex safety: sandbox=${config.codex.sandbox} approval=${config.codex.approval} network=${config.codex.network} webSearch=${config.codex.webSearch}`,
)

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
