import { request as httpRequest } from "node:http"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import WebSocket from "ws"
import type { AgentRuntimeEvent, StartRunRequest } from "../src/domain/runtimeProtocol"
import { createFakeProvider } from "./fakeProvider"
import type { AgentProvider } from "./provider"
import { startRuntimeServer, type RuntimeServerHandle } from "./server"

let handle: RuntimeServerHandle | null = null
let tempDir: string | null = null
const describeRuntimeServer =
  process.env.CODEX_SANDBOX_NETWORK_DISABLED === "1" ? describe.skip : describe

afterEach(async () => {
  await handle?.close()
  handle = null
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

function makeRunRequest(overrides: Partial<StartRunRequest> = {}): StartRunRequest {
  return {
    provider: "codex",
    nodeId: "node-1",
    prompt: "Break this down",
    context: "Project\nFocused bullet",
    ...overrides,
  }
}

function collectEvents(wsUrl: string, count: number): {
  opened: Promise<void>
  events: Promise<AgentRuntimeEvent[]>
} {
  const events: AgentRuntimeEvent[] = []
  let markOpen!: () => void
  const opened = new Promise<void>((resolve) => {
    markOpen = resolve
  })

  const eventsPromise = new Promise<AgentRuntimeEvent[]>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`Timed out waiting for ${count} events; received ${events.length}.`))
    }, 1_000)

    ws.on("open", () => {
      markOpen()
    })
    ws.on("message", (data) => {
      events.push(JSON.parse(data.toString()) as AgentRuntimeEvent)
      if (events.length === count) {
        clearTimeout(timeout)
        ws.close()
        resolve(events)
      }
    })
    ws.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  return { opened, events: eventsPromise }
}

function deferredRunRequest(url: string, body: string): {
  started: Promise<void>
  finish: () => void
  response: Promise<{ status: number; body: unknown }>
} {
  const endpoint = new URL("/runs", url)
  const midpoint = Math.floor(body.length / 2)
  let finish!: () => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const response = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const request = httpRequest(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          connection: "close",
        },
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          })
        })
      },
    )
    request.on("error", reject)
    request.flushHeaders()
    request.write(body.slice(0, midpoint), markStarted)
    finish = () => {
      request.end(body.slice(midpoint))
    }
  })

  return { started, finish, response }
}

function stalledRunRequest(url: string, body: string): { started: Promise<void>; destroy: () => void } {
  const endpoint = new URL("/runs", url)
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const request = httpRequest(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      connection: "close",
    },
  })
  request.on("error", () => {})
  request.flushHeaders()
  request.write(body.slice(0, Math.floor(body.length / 2)), markStarted)
  return {
    started,
    destroy: () => {
      request.destroy()
    },
  }
}

describeRuntimeServer("runtime server", () => {
  it("serves health JSON", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/health`)

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(await response.json()).toEqual({ ok: true, name: "actionpad-runtime" })
  })

  it("serves filesystem directory listings from the user home folder by default", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/filesystem/list`)
    const body = (await response.json()) as { path: string; entries: unknown[] }

    expect(response.status).toBe(200)
    expect(body.path).toBe(homedir())
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it("serves filesystem directory listings for explicit paths", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "actionpad-server-fs-"))
    await mkdir(join(tempDir, "src"))
    await writeFile(join(tempDir, "README.md"), "hello")
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(
      `${handle.url}/filesystem/list?path=${encodeURIComponent(tempDir)}`,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      path: tempDir,
      parentPath: expect.any(String),
      entries: [
        { name: "src", path: join(tempDir, "src"), kind: "folder" },
        { name: "README.md", path: join(tempDir, "README.md"), kind: "file" },
      ],
    })
  })

  it("handles run preflight requests with CORS headers", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs`, {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-methods")).toContain("POST")
    expect(response.headers.get("access-control-allow-headers")).toContain("content-type")
  })

  it("accepts a run and streams fake provider events to websocket clients", async () => {
    const logger = { info: vi.fn() }
    handle = await startRuntimeServer({
      port: 0,
      providers: [createFakeProvider()],
      logger,
    })
    const collector = collectEvents(handle.wsUrl, 6)
    await collector.opened

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })

    const events = await collector.events

    expect(events.map((event) => event.type)).toEqual([
      "run-started",
      "assistant-message-started",
      "assistant-delta",
      "assistant-message-completed",
      "outline-patch",
      "run-completed",
    ])
    expect(events[0]).toMatchObject({ runId: "fake-run-node-1", threadId: "fake-thread-node-1" })
    expect(events[4]).toMatchObject({
      patch: {
        type: "append-child-bullets",
        parentId: "node-1",
        bullets: [
          {
            text: "Clarify the next action.",
            children: [{ text: "Keep the output short enough to scan." }],
          },
          { text: "Identify the smallest useful test." },
        ],
      },
    })
    expect(logger.info).toHaveBeenCalledWith(
      '[runtime] chat start kind=run provider=codex nodeId=node-1 prompt="Break this down..."',
    )
    expect(logger.info).toHaveBeenCalledWith(
      "[runtime] chat event run-started runId=fake-run-node-1 threadId=fake-thread-node-1 nodeId=node-1 provider=codex",
    )
    expect(logger.info).toHaveBeenCalledWith(
      "[runtime] chat return outline-patch runId=fake-run-node-1 outcome=succeeded",
    )
    expect(logger.info).toHaveBeenCalledWith(
      "[runtime] chat turn-end runId=fake-run-node-1 outcome=succeeded",
    )
  })

  it("accepts a follow-up message and streams provider events", async () => {
    const logger = { info: vi.fn() }
    handle = await startRuntimeServer({
      port: 0,
      providers: [createFakeProvider()],
      logger,
    })
    const collector = collectEvents(handle.wsUrl, 6)
    await collector.opened

    const response = await fetch(`${handle.url}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...makeRunRequest({ prompt: "Make it shorter." }),
        threadId: "thread-node-1",
        providerThreadId: null,
      }),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })

    const events = await collector.events
    expect(events[0]).toMatchObject({
      type: "run-started",
      threadId: "thread-node-1",
      prompt: "Make it shorter.",
    })
    expect(events[4]).toMatchObject({
      patch: {
        type: "append-child-bullets",
        parentId: "node-1",
        bullets: [{ text: "Follow-up: Make it shorter." }],
      },
    })
    expect(logger.info).toHaveBeenCalledWith(
      '[runtime] chat start kind=follow-up provider=codex nodeId=node-1 threadId=thread-node-1 prompt="Make it shorter...."',
    )
  })

  it("rejects invalid run requests", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "codex", nodeId: "node-1" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid run request." })
  })

  it("rejects unsupported providers", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest({ provider: "missing" as StartRunRequest["provider"] })),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Unsupported provider." })
  })

  it("broadcasts run-failed with the yielded run id when a provider throws", async () => {
    const failingProvider: AgentProvider = {
      ...createFakeProvider(),
      async *startRun(request) {
        yield {
          type: "run-started",
          runId: "run-before-failure",
          threadId: "thread-before-failure",
          nodeId: request.nodeId,
          createdAt: 1,
        }
        throw new Error("provider exploded")
      },
    }
    handle = await startRuntimeServer({ port: 0, providers: [failingProvider] })
    const collector = collectEvents(handle.wsUrl, 2)
    await collector.opened

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })

    expect(response.status).toBe(202)
    const events = await collector.events

    expect(events[1]).toMatchObject({
      type: "run-failed",
      runId: "run-before-failure",
      error: "provider exploded",
    })
  })

  it("broadcasts run-failed with unknown run id when a provider throws before yielding", async () => {
    const failingProvider: AgentProvider = {
      ...createFakeProvider(),
      async *startRun() {
        throw new Error("early provider failure")
      },
    }
    handle = await startRuntimeServer({ port: 0, providers: [failingProvider] })
    const collector = collectEvents(handle.wsUrl, 1)
    await collector.opened

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })

    expect(response.status).toBe(202)
    await expect(collector.events).resolves.toMatchObject([
      {
        type: "run-failed",
        runId: "unknown",
        error: "early provider failure",
      },
    ])
  })

  it("cancels known active provider runs before closing", async () => {
    let releaseRun!: () => void
    const cancelRun = vi.fn()
    const provider: AgentProvider = {
      ...createFakeProvider(),
      cancelRun,
      async *startRun(request) {
        yield {
          type: "run-started",
          runId: "run-to-cancel",
          threadId: "thread-to-cancel",
          nodeId: request.nodeId,
          createdAt: 1,
        }
        await new Promise<void>((resolve) => {
          releaseRun = resolve
        })
      },
    }
    handle = await startRuntimeServer({ port: 0, providers: [provider] })
    const collector = collectEvents(handle.wsUrl, 1)
    await collector.opened

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })
    await collector.events

    const closePromise = handle.close()
    releaseRun()
    await closePromise
    handle = null

    expect(response.status).toBe(202)
    expect(cancelRun).toHaveBeenCalledWith("run-to-cancel")
  })

  it("cancels an active run through the cancel endpoint and broadcasts a failed terminal event", async () => {
    let releaseRun!: () => void
    const cancelRun = vi.fn()
    const logger = { info: vi.fn() }
    const provider: AgentProvider = {
      ...createFakeProvider(),
      cancelRun,
      async *startRun(request) {
        yield {
          type: "run-started",
          runId: "run-to-stop",
          threadId: "thread-to-stop",
          nodeId: request.nodeId,
          createdAt: 1,
        }
        await new Promise<void>((resolve) => {
          releaseRun = resolve
        })
      },
    }
    handle = await startRuntimeServer({
      port: 0,
      providers: [provider],
      logger,
    })
    const collector = collectEvents(handle.wsUrl, 2)
    await collector.opened

    const runResponse = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })
    expect(runResponse.status).toBe(202)

    const cancelResponse = await fetch(`${handle.url}/runs/run-to-stop/cancel`, {
      method: "POST",
    })
    releaseRun()

    expect(cancelResponse.status).toBe(202)
    expect(await cancelResponse.json()).toEqual({ cancelled: true })
    expect(cancelRun).toHaveBeenCalledWith("run-to-stop")
    await expect(collector.events).resolves.toMatchObject([
      { type: "run-started", runId: "run-to-stop" },
      { type: "run-failed", runId: "run-to-stop", error: "Cancelled." },
    ])
    expect(logger.info).toHaveBeenCalledWith(
      "[runtime] chat stop requested runId=run-to-stop",
    )
    expect(logger.info).toHaveBeenCalledWith(
      '[runtime] chat turn-end runId=run-to-stop outcome=failed error="Cancelled."',
    )
  })

  it("rejects cancel requests for runs that are not active", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })

    const response = await fetch(`${handle.url}/runs/missing-run/cancel`, {
      method: "POST",
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Run is no longer active." })
  })

  it("closes even when an active provider stream never settles", async () => {
    const cancelRun = vi.fn()
    const provider: AgentProvider = {
      ...createFakeProvider(),
      cancelRun,
      async *startRun(request) {
        yield {
          type: "run-started",
          runId: "run-that-never-stops",
          threadId: "thread-that-never-stops",
          nodeId: request.nodeId,
          createdAt: 1,
        }
        await new Promise<never>(() => {})
      },
    }
    handle = await startRuntimeServer({ port: 0, providers: [provider] })
    const collector = collectEvents(handle.wsUrl, 1)
    await collector.opened

    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })
    await collector.events

    const startedAt = Date.now()
    await handle.close()
    handle = null

    expect(response.status).toBe(202)
    expect(cancelRun).toHaveBeenCalledWith("run-that-never-stops")
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it("closes even when cancelRun rejects", async () => {
    const provider: AgentProvider = {
      ...createFakeProvider(),
      cancelRun: vi.fn().mockRejectedValue(new Error("cancel failed")),
      async *startRun(request) {
        yield {
          type: "run-started",
          runId: "run-with-failed-cancel",
          threadId: "thread-with-failed-cancel",
          nodeId: request.nodeId,
          createdAt: 1,
        }
        await new Promise<never>(() => {})
      },
    }
    handle = await startRuntimeServer({ port: 0, providers: [provider] })
    const collector = collectEvents(handle.wsUrl, 1)
    await collector.opened

    await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })
    await collector.events

    await handle.close()
    handle = null

    expect(provider.cancelRun).toHaveBeenCalledWith("run-with-failed-cancel")
  })

  it("rejects a delayed run request that finishes parsing after shutdown begins", async () => {
    const provider: AgentProvider = {
      ...createFakeProvider(),
      startRun: vi.fn(createFakeProvider().startRun),
    }
    handle = await startRuntimeServer({ port: 0, providers: [provider] })
    const pendingRequest = deferredRunRequest(handle.url, JSON.stringify(makeRunRequest()))
    await pendingRequest.started

    const closePromise = handle.close()
    pendingRequest.finish()
    const response = await pendingRequest.response
    await closePromise
    handle = null

    expect(response).toEqual({
      status: 503,
      body: { error: "Runtime is shutting down." },
    })
    expect(provider.startRun).not.toHaveBeenCalled()
  })

  it("closes with an open websocket client", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })
    const socket = new WebSocket(handle.wsUrl)
    const socketClosed = new Promise<void>((resolve) => {
      socket.on("close", resolve)
    })
    await new Promise<void>((resolve, reject) => {
      socket.on("open", resolve)
      socket.on("error", reject)
    })

    const startedAt = Date.now()
    await handle.close()
    handle = null

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    await socketClosed
    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  it("closes while a run request body is stalled", async () => {
    handle = await startRuntimeServer({ port: 0, providers: [createFakeProvider()] })
    const request = stalledRunRequest(handle.url, JSON.stringify(makeRunRequest()))
    await request.started

    const startedAt = Date.now()
    const closePromise = handle.close()
    const result = await Promise.race([
      closePromise.then(() => "closed"),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 1_000)
      }),
    ])
    if (result !== "closed") {
      request.destroy()
      await closePromise
    }
    handle = null

    expect(result).toBe("closed")
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it("rejects new runs while shutdown is waiting on active providers", async () => {
    let releaseRun!: () => void
    const provider: AgentProvider = {
      ...createFakeProvider(),
      async *startRun(request) {
        yield {
          type: "run-started",
          runId: "run-during-shutdown",
          threadId: "thread-during-shutdown",
          nodeId: request.nodeId,
          createdAt: 1,
        }
        await new Promise<void>((resolve) => {
          releaseRun = resolve
        })
      },
    }
    handle = await startRuntimeServer({ port: 0, providers: [provider] })
    const collector = collectEvents(handle.wsUrl, 1)
    await collector.opened

    await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })
    await collector.events

    const closePromise = handle.close()
    const response = await fetch(`${handle.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRunRequest()),
    })
    releaseRun()
    await closePromise
    handle = null

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Runtime is shutting down." })
  })
})
