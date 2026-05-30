import { createCodexProvider } from "./codexProvider"
import { createFakeProvider } from "./fakeProvider"
import { startRuntimeServer } from "./server"

const port = Number(process.env.ACTIONPAD_RUNTIME_PORT ?? 43_217)
const provider =
  process.env.ACTIONPAD_PROVIDER === "codex" ? createCodexProvider() : createFakeProvider()
const handle = await startRuntimeServer({ port, providers: [provider] })

console.log(`Actionpad runtime listening at ${handle.url}`)
console.log(
  `Actionpad provider: ${provider.id}${process.env.ACTIONPAD_PROVIDER === "codex" ? " codex" : " fake"}`,
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
