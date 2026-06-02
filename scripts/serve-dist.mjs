#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getActionpadDefaultConfig } from "./actionpadDefaults.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, "..")

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".map", "application/json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

export function getMimeType(filePath) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
}

export function resolveDistPath(distDir, requestPathname) {
  const pathname = decodeURIComponent(requestPathname.split("?")[0] || "/")
  const relative = pathname.replace(/^\/+/, "") || "index.html"
  const resolved = path.resolve(distDir, relative)
  const root = path.resolve(distDir)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  return resolved
}

export async function getServeTarget(distDir, requestPathname) {
  const resolved = resolveDistPath(distDir, requestPathname)
  if (!resolved) return null
  try {
    const stat = await fs.promises.stat(resolved)
    if (stat.isFile()) return resolved
    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, "index.html")
      const indexStat = await fs.promises.stat(indexPath)
      if (indexStat.isFile()) return indexPath
    }
  } catch {
    const hasExtension = path.extname(new URL(requestPathname, "http://127.0.0.1").pathname) !== ""
    if (!hasExtension) {
      return path.join(distDir, "index.html")
    }
  }
  return null
}

export function createStaticServer({ distDir = path.join(appRoot, "dist") } = {}) {
  return http.createServer(async (request, response) => {
    const target = await getServeTarget(distDir, request.url ?? "/")
    if (!target) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      response.end("Not found")
      return
    }

    response.writeHead(200, {
      "content-type": getMimeType(target),
      "cache-control": path.basename(target) === "index.html" ? "no-cache" : "public, max-age=31536000",
    })
    fs.createReadStream(target).pipe(response)
  })
}

export function getDefaultServeOptions(env = process.env) {
  const defaults = getActionpadDefaultConfig()
  return {
    port: Number(env.ACTIONPAD_WEB_PORT ?? defaults.ACTIONPAD_WEB_PORT),
    host: env.ACTIONPAD_HOST || defaults.ACTIONPAD_HOST,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, host } = getDefaultServeOptions()
  const server = createStaticServer()
  server.listen(port, host, () => {
    console.log(`Actionpad web listening at http://${host}:${port}`)
  })
}
