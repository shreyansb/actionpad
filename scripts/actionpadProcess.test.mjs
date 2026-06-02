// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readPidFile, removeStalePidFile, waitForHttpOk } from "./actionpadProcess.mjs"

let tempDir

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "actionpad-process-"))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.promises.rm(tempDir, { recursive: true, force: true })
})

describe("actionpad process helpers", () => {
  it("reports missing PID files as not running", async () => {
    await expect(readPidFile(path.join(tempDir, "missing.pid"))).resolves.toBeNull()
  })

  it("removes dead PID files", async () => {
    const pidFile = path.join(tempDir, "dead.pid")
    await fs.promises.writeFile(pidFile, "99999999\n")
    await expect(removeStalePidFile(pidFile)).resolves.toEqual({ removed: true, pid: 99999999 })
    await expect(readPidFile(pidFile)).resolves.toBeNull()
  })

  it("waits for HTTP success and times out cleanly", async () => {
    vi.spyOn(http, "get").mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter()
      request.destroy = vi.fn()
      const response = new EventEmitter()
      response.statusCode = 200
      response.resume = vi.fn()
      queueMicrotask(() => callback(response))
      return request
    })
    await expect(waitForHttpOk("http://127.0.0.1:43217", { timeoutMs: 500 })).resolves.toBe(true)

    http.get.mockImplementation((_url, _options, _callback) => {
      const request = new EventEmitter()
      request.destroy = vi.fn()
      queueMicrotask(() => request.emit("error", new Error("refused")))
      return request
    })
    await expect(waitForHttpOk("http://127.0.0.1:43218", { timeoutMs: 100, intervalMs: 20 })).rejects.toThrow(
      /Timed out/,
    )
  })
})
