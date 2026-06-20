import { basename } from "node:path"

export function isCompiledRuntime(execPath: string): boolean {
  // Split on both / and \ to handle Windows paths on any platform
  const parts = execPath.split(/[\\/]/)
  const last = parts[parts.length - 1] ?? ""
  const name = (last || basename(execPath)).toLowerCase().replace(/\.exe$/, "")
  return name !== "bun" && name !== "node"
}
