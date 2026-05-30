import { createFakeProvider } from "./fakeProvider"
import { startRuntimeServer } from "./server"

const port = Number(process.env.ACTIONPAD_RUNTIME_PORT ?? 43_217)
const handle = await startRuntimeServer({ port, providers: [createFakeProvider()] })

console.log(`Actionpad runtime listening at ${handle.url}`)

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
