import { installRuntimeShutdownHandlers, startRuntimeFromEnv } from "./main"
import { runActionpadMcpHttp } from "./mcp/httpMain"
import { runActionpadMcpStdio } from "./mcp/stdioMain"
import { isCompiledRuntime } from "./isCompiledRuntime"

const mode = process.argv[2]

async function runRuntime(): Promise<void> {
  // When running as a compiled binary, re-exec THIS binary for the per-run MCP
  // stdio server instead of `node --import tsx runtime/mcp/stdioMain.ts`.
  if (isCompiledRuntime(process.execPath)) {
    process.env.ACTIONPAD_MCP_STDIO_COMMAND ??= process.execPath
    process.env.ACTIONPAD_MCP_STDIO_ARGS ??= JSON.stringify(["--mcp-stdio"])
    process.env.ACTIONPAD_MCP_STDIO_CWD ??= process.cwd()
  }
  const handle = await startRuntimeFromEnv()
  installRuntimeShutdownHandlers(handle)
}

async function main(): Promise<void> {
  if (mode === "--mcp-stdio") {
    await runActionpadMcpStdio({ ...process.env, ACTIONPAD_MCP_TRANSPORT: "stdio" })
    return
  }
  if (mode === "--mcp-http") {
    await runActionpadMcpHttp({ ...process.env, ACTIONPAD_MCP_TRANSPORT: "http" })
    return
  }
  await runRuntime()
}

main().catch((error) => {
  console.error("Actionpad runtime entry failed:", error)
  process.exit(1)
})
